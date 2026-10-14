// Fixed window image bridge for local preview and separately authorized model
// observation. No files, input, network,
// authorization prompts, whole-display captures or arbitrary selectors.
#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <ImageIO/ImageIO.h>
#include <math.h>
#include <stdint.h>
#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
    unsigned char *bytes;
    size_t length;
    uint32_t width;
    uint32_t height;
    uint32_t error;
} FieloraPreviewImage;

enum { PreviewUnsupported = 1, PreviewPermission = 2, PreviewUnavailable = 3,
       PreviewAmbiguous = 4, PreviewFailed = 5, PreviewTimeout = 6,
       PreviewTooLarge = 7, PreviewBusy = 8 };
static atomic_bool capturePending = false;
static atomic_uint modelCaptureWaiters = 0;

// Model observations are required for the next input, while local thumbnails
// are optional. Reserve their turn before waiting for an already-running
// preview. A timed-out native callback continues to own capturePending.
void fielora_computer_visual_priority(bool waiting) {
    if (waiting) atomic_fetch_add(&modelCaptureWaiters, 1);
    else atomic_fetch_sub(&modelCaptureWaiters, 1);
}

// An in-flight API callback owns this lease even after its synchronous caller
// times out. This bounds the entire metadata→capture pipeline to one request;
// repeated timeouts cannot accumulate background ScreenCaptureKit operations.
@interface FieloraPreviewLease : NSObject
- (void)signal:(dispatch_semaphore_t)semaphore;
@end
@implementation FieloraPreviewLease
- (void)signal:(dispatch_semaphore_t)semaphore { dispatch_semaphore_signal(semaphore); }
- (void)dealloc { atomic_store(&capturePending, false); }
@end

static void encodeImage(CGImageRef image, FieloraPreviewImage *output,
                        size_t maxBytes, size_t maxWidth, size_t maxHeight) {
    if (!image) { output->error = PreviewFailed; return; }
    size_t width = CGImageGetWidth(image), height = CGImageGetHeight(image);
    if (!width || !height || width > maxWidth || height > maxHeight) {
        output->error = PreviewTooLarge; return;
    }
    NSMutableData *data = [NSMutableData data];
    CGImageDestinationRef destination = CGImageDestinationCreateWithData(
        (__bridge CFMutableDataRef)data, CFSTR("public.png"), 1, NULL);
    if (!destination) { output->error = PreviewFailed; return; }
    CGImageDestinationAddImage(destination, image, NULL);
    BOOL encoded = CGImageDestinationFinalize(destination);
    CFRelease(destination);
    if (!encoded || !data.length || data.length > maxBytes) {
        output->error = PreviewTooLarge; return;
    }
    output->bytes = malloc(data.length);
    if (!output->bytes) { output->error = PreviewFailed; return; }
    memcpy(output->bytes, data.bytes, data.length);
    output->length = data.length;
    output->width = (uint32_t)width;
    output->height = (uint32_t)height;
    output->error = 0;
}

// Model admission accepts a deliberately small PNG subset. Draw native pixels
// into fixed sRGB/RGBA before encoding, then retain only generated image chunks.
// Do not normalize user-uploaded files or relax the downstream PNG validator.
static void encodeModelImage(CGImageRef image, FieloraPreviewImage *output,
                             size_t maxWidth, size_t maxHeight) {
    if (!image) { output->error = PreviewFailed; return; }
    size_t width = CGImageGetWidth(image), height = CGImageGetHeight(image);
    if (!width || !height || width > maxWidth || height > maxHeight) {
        output->error = PreviewTooLarge; return;
    }
    CGColorSpaceRef colors = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
    CGContextRef context = CGBitmapContextCreate(NULL, width, height, 8, width * 4,
        colors, (CGBitmapInfo)kCGImageAlphaPremultipliedLast);
    CGColorSpaceRelease(colors);
    if (!context) { output->error = PreviewFailed; return; }
    CGContextDrawImage(context, CGRectMake(0, 0, width, height), image);
    CGImageRef normalized = CGBitmapContextCreateImage(context);
    FieloraPreviewImage encoded = {0};
    encodeImage(normalized, &encoded, 4194304, maxWidth, maxHeight);
    if (normalized) CGImageRelease(normalized);
    CGContextRelease(context);
    if (encoded.error) { output->error = encoded.error; return; }
    if (encoded.length < 8) { free(encoded.bytes); output->error = PreviewFailed; return; }
    NSMutableData *data = [NSMutableData dataWithBytes:encoded.bytes length:8];
    size_t offset = 8;
    BOOL valid = encoded.length >= 8;
    while (valid && offset < encoded.length) {
        if (encoded.length - offset < 12) { valid = NO; break; }
        const unsigned char *chunk = encoded.bytes + offset;
        uint32_t length = ((uint32_t)chunk[0] << 24) | ((uint32_t)chunk[1] << 16)
            | ((uint32_t)chunk[2] << 8) | (uint32_t)chunk[3];
        if ((size_t)length > encoded.length - offset - 12) { valid = NO; break; }
        BOOL keep = !memcmp(chunk + 4, "IHDR", 4) || !memcmp(chunk + 4, "IDAT", 4)
            || !memcmp(chunk + 4, "IEND", 4);
        if (!keep && !(chunk[4] & 0x20)) { valid = NO; break; }
        if (keep) [data appendBytes:chunk length:(size_t)length + 12];
        offset += (size_t)length + 12;
    }
    free(encoded.bytes);
    if (!valid || !data.length || data.length > 4194304) { output->error = PreviewFailed; return; }
    output->bytes = malloc(data.length);
    if (!output->bytes) { output->error = PreviewFailed; return; }
    memcpy(output->bytes, data.bytes, data.length);
    output->length = data.length;
    output->width = (uint32_t)width;
    output->height = (uint32_t)height;
    output->error = 0;
}

void fielora_computer_preview_free(unsigned char *bytes) { free(bytes); }

void fielora_computer_preview_icon(int32_t pid, FieloraPreviewImage *output) {
    @autoreleasepool {
        memset(output, 0, sizeof(*output));
        output->error = PreviewUnavailable;
        NSRunningApplication *application = [NSRunningApplication runningApplicationWithProcessIdentifier:pid];
        if (!application || application.terminated || !application.icon) return;
        CGColorSpaceRef colors = CGColorSpaceCreateDeviceRGB();
        CGContextRef context = CGBitmapContextCreate(NULL, 64, 64, 8, 64 * 4,
            colors, (CGBitmapInfo)kCGImageAlphaPremultipliedLast);
        CGColorSpaceRelease(colors);
        if (!context) { output->error = PreviewFailed; return; }
        NSGraphicsContext *graphics = [NSGraphicsContext graphicsContextWithCGContext:context flipped:NO];
        [NSGraphicsContext saveGraphicsState];
        [NSGraphicsContext setCurrentContext:graphics];
        [application.icon drawInRect:NSMakeRect(0, 0, 64, 64)
                           fromRect:NSZeroRect operation:NSCompositingOperationCopy fraction:1.0];
        [NSGraphicsContext restoreGraphicsState];
        CGImageRef image = CGBitmapContextCreateImage(context);
        encodeImage(image, output, 65536, 64, 64);
        if (image) CGImageRelease(image);
        CGContextRelease(context);
    }
}

// Enumeration returns metadata only. Pixel acquisition happens exactly once,
// after a unique same-PID/title/frame match and a single-window content filter.
// Completion blocks retain only heap-owned locals. A timeout never leaves a
// callback with the caller's stack or Rust output pointer.
static void captureWindow(int32_t pid, const double *bounds,
                          const char *title, size_t maxWidth, size_t maxHeight,
                          BOOL modelImage, FieloraPreviewImage *output) {
    @autoreleasepool {
        memset(output, 0, sizeof(*output));
        output->error = PreviewUnsupported;
        if (@available(macOS 14.0, *)) {
            if (!CGPreflightScreenCaptureAccess()) { output->error = PreviewPermission; return; }
            // Electron's existing host still admits macOS 12.0. Do not add a
            // strong framework load that prevents startup on 12.0-12.2. Only
            // this fixed public framework/classes are loaded, after the OS
            // availability check; there is no user-controlled native loader.
            NSBundle *framework = [NSBundle bundleWithPath:@"/System/Library/Frameworks/ScreenCaptureKit.framework"];
            if (![framework load]) return;
            Class shareableContentClass = NSClassFromString(@"SCShareableContent");
            Class contentFilterClass = NSClassFromString(@"SCContentFilter");
            Class configurationClass = NSClassFromString(@"SCStreamConfiguration");
            Class screenshotClass = NSClassFromString(@"SCScreenshotManager");
            if (!shareableContentClass || !contentFilterClass || !configurationClass || !screenshotClass) return;
            CGRect target = CGRectMake(bounds[0], bounds[1], bounds[2], bounds[3]);
            if (!isfinite(target.origin.x) || !isfinite(target.origin.y) ||
                !isfinite(target.size.width) || !isfinite(target.size.height) ||
                target.size.width <= 0 || target.size.height <= 0 ||
                target.size.width > 32768 || target.size.height > 32768) {
                output->error = PreviewUnavailable; return;
            }
            NSString *expectedTitle = [NSString stringWithUTF8String:title];
            if (!expectedTitle.length) { output->error = PreviewUnavailable; return; }
            if (!modelImage && atomic_load(&modelCaptureWaiters)) {
                output->error = PreviewBusy; return;
            }
            bool expected = false;
            if (!atomic_compare_exchange_strong(&capturePending, &expected, true)) {
                output->error = PreviewBusy; return;
            }
            // Close the race with a model waiter registering after the first
            // check. No ScreenCaptureKit work has started at this point.
            if (!modelImage && atomic_load(&modelCaptureWaiters)) {
                atomic_store(&capturePending, false);
                output->error = PreviewBusy; return;
            }
            FieloraPreviewLease *lease = [FieloraPreviewLease new];
            if (!lease) { atomic_store(&capturePending, false); output->error = PreviewFailed; return; }
            dispatch_semaphore_t ready = dispatch_semaphore_create(0);
            __block SCShareableContent *content = nil;
            [shareableContentClass getShareableContentExcludingDesktopWindows:YES onScreenWindowsOnly:NO
                completionHandler:^(SCShareableContent *value, NSError *error) {
                    if (!error) content = value;
                    [lease signal:ready];
                }];
            if (dispatch_semaphore_wait(ready, dispatch_time(DISPATCH_TIME_NOW, 1500 * NSEC_PER_MSEC))) {
                output->error = PreviewTimeout; return;
            }
            if (!content) { output->error = PreviewUnavailable; return; }
            SCWindow *selected = nil;
            for (SCWindow *window in content.windows) {
                if (window.owningApplication.processID != pid) continue;
                CGRect frame = window.frame;
                if (fabs(frame.origin.x - target.origin.x) > 0.5 || fabs(frame.origin.y - target.origin.y) > 0.5 ||
                    fabs(frame.size.width - target.size.width) > 0.5 || fabs(frame.size.height - target.size.height) > 0.5) continue;
                if (![window.title isEqualToString:expectedTitle]) continue;
                if (selected) { output->error = PreviewAmbiguous; return; }
                selected = window;
            }
            if (!selected || !selected.onScreen || selected.windowLayer != 0 || !CGPreflightScreenCaptureAccess()) {
                output->error = PreviewUnavailable; return;
            }
            SCContentFilter *filter = [[contentFilterClass alloc] initWithDesktopIndependentWindow:selected];
            SCStreamConfiguration *config = [configurationClass new];
            double scale = fmin(1.0, fmin((double)maxWidth / target.size.width, (double)maxHeight / target.size.height));
            config.width = MAX(1, (size_t)floor(target.size.width * scale));
            config.height = MAX(1, (size_t)floor(target.size.height * scale));
            config.showsCursor = NO;
            config.capturesAudio = NO;
            config.ignoreShadowsSingleWindow = YES;
            // SCStreamConfiguration's default sourceRect is the entire
            // independent window in screen points. Model coordinates map that
            // exact frame onto all output pixels, without global clipping or
            // aspect-ratio letterboxing caused by integral output dimensions.
            // Actual native input still requires an on-screen, unoccluded hit.
            config.ignoreGlobalClipSingleWindow = modelImage;
            config.preservesAspectRatio = !modelImage;
            // Keep the explicitly selected window as the entire capture scope.
            if (@available(macOS 14.2, *)) config.includeChildWindows = NO;
            dispatch_semaphore_t captured = dispatch_semaphore_create(0);
            __block id retainedImage = nil;
            [screenshotClass captureImageWithFilter:filter configuration:config
                completionHandler:^(CGImageRef image, NSError *error) {
                    if (image && !error) retainedImage = (__bridge id)image;
                    [lease signal:captured];
                }];
            if (dispatch_semaphore_wait(captured, dispatch_time(DISPATCH_TIME_NOW, 1500 * NSEC_PER_MSEC))) {
                output->error = PreviewTimeout; return;
            }
            if (!retainedImage) { output->error = PreviewFailed; return; }
            if (modelImage) encodeModelImage((__bridge CGImageRef)retainedImage, output, maxWidth, maxHeight);
            else encodeImage((__bridge CGImageRef)retainedImage, output, 2097152, maxWidth, maxHeight);
        }
    }
}

bool fielora_computer_visual_available(void) {
    if (@available(macOS 14.0, *)) return true;
    return false;
}

void fielora_computer_preview_capture(int32_t pid, const double *bounds,
                                     const char *title, FieloraPreviewImage *output) {
    captureWindow(pid, bounds, title, 960, 640, NO, output);
}

void fielora_computer_visual_capture(int32_t pid, const double *bounds,
                                    const char *title, FieloraPreviewImage *output) {
    captureWindow(pid, bounds, title, 1280, 960, YES, output);
}
