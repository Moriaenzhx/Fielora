//! Semantic Artifact validation and export through the existing Tool backend.
//!
//! Fielora-owned semantic DTOs live in `fielora-contracts`; `office_oxide`
//! remains a stateless renderer adapter detail, not persisted authority.

use crate::{
    AgentError, CommandCancellation, ToolExecution, ToolRuntime, atomic_write, deny_sensitive,
    diagram, normalize_relative, relative_text, resolve_for_write, sha256, spreadsheet,
};
use fielora_contracts::{
    ArtifactAssetRefV1, ArtifactContentV1, ArtifactId, ArtifactReadView, ArtifactRevisionId,
    ArtifactType as DurableArtifactType, AssetMediaType, AssetView, DiagramArtifactV1,
    DocumentArtifact, DocumentBlock, PresentationArtifact, PresentationBlock,
    PresentationImageFitV1, PresentationLayout, PresentationSlide, SlideRegion, SlideSlot,
    SpreadsheetArtifactV1, SpreadsheetRangeEmbedV1,
};
use office_oxide::docx::write::DocxWriter;
use office_oxide::ir::{Image, ImageFormat, ImagePositioning};
use office_oxide::pptx::write::{PptxWriter, Run, SlideData};
use office_oxide::{Document, DocumentFormat};
use quick_xml::Reader as XmlReader;
use quick_xml::events::Event as XmlEvent;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::fs;
use std::io::{Cursor, Read};
use std::path::Path;
use std::time::{Duration, Instant};
use uuid::Uuid;
use zip::ZipArchive;

const ARTIFACT_SCHEMA_VERSION: u16 = 1;
const ARTIFACT_REVISION: u16 = 1;
const DOCUMENT_RENDERER_VERSION: &str = "0.1.0+office_oxide.0.1.8";
const PRESENTATION_RENDERER_VERSION: &str = "0.2.0+office_oxide.0.1.8";
const MAX_DEFINITION_BYTES: usize = 256 * 1024;
const MAX_TOTAL_TEXT_BYTES: usize = 128 * 1024;
const MAX_TEXT_ITEM_BYTES: usize = 16 * 1024;
const MAX_DOCUMENT_BLOCKS: usize = 256;
const MAX_LISTS: usize = 64;
const MAX_LIST_ITEMS_PER_LIST: usize = 64;
const MAX_TOTAL_LIST_ITEMS: usize = 1_024;
const MAX_TABLES: usize = 16;
const MAX_TABLE_ROWS: usize = 64;
const MAX_TABLE_COLUMNS: usize = 16;
const MAX_TABLE_CELLS: usize = 4_096;
const MAX_SLIDES: usize = 32;
const MAX_REGIONS_PER_SLIDE: usize = 3;
const MAX_BLOCKS_PER_REGION: usize = 16;
const MAX_ELEMENTS_PER_SLIDE: usize = 32;
const MAX_SLIDE_TEXT_BYTES: usize = 16 * 1024;
const MAX_OUTPUT_BYTES: usize = 16 * 1024 * 1024;
const MAX_TOOL_RESULT_BYTES: usize = 64 * 1024;
const MAX_REFERENCES_PER_REVISION: usize = 16;
const MAX_ASSETS_PER_REVISION: usize = 16;
const MAX_ALT_TEXT_BYTES: usize = 1024;
const DOCUMENT_MAX_IMAGE_WIDTH_EMU: u64 = 5_943_600;
const DOCUMENT_MAX_IMAGE_HEIGHT_EMU: u64 = 7_315_200;
const MAX_TRANSITIVE_DEPENDENCIES: usize = 32;
const MAX_COMPOSITION_DEPTH: usize = 4;
const MAX_CHILD_SEMANTIC_JSON_BYTES: usize = 1024 * 1024;
const MAX_RANGE_CELLS: usize = 1_024;
const EXPORT_DEADLINE: Duration = Duration::from_secs(10);

const EMU_PER_POINT: f64 = 12_700.0;
const PRESENTATION_WIDTH_EMU: i64 = 12_192_000;
const PRESENTATION_HEIGHT_EMU: i64 = 6_858_000;
const LATIN_FONT: &str = "Arial";
const CJK_FONT: &str = "Microsoft YaHei";
const PRIMARY_TEXT_COLOR: &str = "172033";
const SECONDARY_TEXT_COLOR: &str = "526273";
const ACCENT_TEXT_COLOR: &str = "315A80";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum ArtifactType {
    Document,
    Presentation,
}

impl ArtifactType {
    fn id(self) -> &'static str {
        match self {
            Self::Document => "DOCUMENT",
            Self::Presentation => "PRESENTATION",
        }
    }

    fn format(self) -> DocumentFormat {
        match self {
            Self::Document => DocumentFormat::Docx,
            Self::Presentation => DocumentFormat::Pptx,
        }
    }

    fn extension(self) -> &'static str {
        match self {
            Self::Document => "docx",
            Self::Presentation => "pptx",
        }
    }

    fn renderer_id(self) -> &'static str {
        match self {
            Self::Document => "fielora.office.docx",
            Self::Presentation => "fielora.office.pptx",
        }
    }

    fn renderer_version(self) -> &'static str {
        match self {
            Self::Document => DOCUMENT_RENDERER_VERSION,
            Self::Presentation => PRESENTATION_RENDERER_VERSION,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct SlideRect {
    x: i64,
    y: i64,
    width: i64,
    height: i64,
}

impl SlideRect {
    fn right(self) -> i64 {
        self.x + self.width
    }

    fn bottom(self) -> i64 {
        self.y + self.height
    }

    fn contains(self, other: Self) -> bool {
        other.x >= self.x
            && other.y >= self.y
            && other.right() <= self.right()
            && other.bottom() <= self.bottom()
    }

    fn overlaps(self, other: Self) -> bool {
        self.x < other.right()
            && self.right() > other.x
            && self.y < other.bottom()
            && self.bottom() > other.y
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct SlideMetrics {
    slide: SlideRect,
    margin_left: i64,
    margin_right: i64,
    margin_top: i64,
    margin_bottom: i64,
    cover_title: SlideRect,
    cover_subtitle: SlideRect,
    title: SlideRect,
    body: SlideRect,
    left: SlideRect,
    right: SlideRect,
    column_gap: i64,
    column_padding: i64,
}

impl SlideMetrics {
    fn widescreen() -> Self {
        let slide = SlideRect {
            x: 0,
            y: 0,
            width: PRESENTATION_WIDTH_EMU,
            height: PRESENTATION_HEIGHT_EMU,
        };
        let margin_left = 777_240;
        let margin_right = 777_240;
        let margin_top = 457_200;
        let margin_bottom = 618_000;
        let body = SlideRect {
            x: margin_left,
            y: 1_520_000,
            width: PRESENTATION_WIDTH_EMU - margin_left - margin_right,
            height: PRESENTATION_HEIGHT_EMU - 1_520_000 - margin_bottom,
        };
        let column_gap = 457_200;
        let column_padding = 95_250;
        let column_width = (body.width - column_padding * 2 - column_gap) / 2;
        Self {
            slide,
            margin_left,
            margin_right,
            margin_top,
            margin_bottom,
            cover_title: SlideRect {
                x: 1_097_280,
                y: 1_500_000,
                width: 9_997_440,
                height: 1_250_000,
            },
            cover_subtitle: SlideRect {
                x: 1_097_280,
                y: 3_050_000,
                width: 9_997_440,
                height: 1_450_000,
            },
            title: SlideRect {
                x: margin_left,
                y: margin_top,
                width: PRESENTATION_WIDTH_EMU - margin_left - margin_right,
                height: 850_000,
            },
            body,
            left: SlideRect {
                x: body.x + column_padding,
                y: body.y,
                width: column_width,
                height: body.height,
            },
            right: SlideRect {
                x: body.x + column_padding + column_width + column_gap,
                y: body.y,
                width: column_width,
                height: body.height,
            },
            column_gap,
            column_padding,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum ContentDensity {
    Low,
    Normal,
    High,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PresentationTextRole {
    CoverTitle,
    CoverSubtitle,
    SlideTitle,
    ColumnHeading,
    Body,
    BulletMarker,
    Bullet,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct PresentationTextStyle {
    role: PresentationTextRole,
    font_size_pt: u16,
    bold: bool,
    color: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PlannedTextLine {
    text: String,
    rect: SlideRect,
    style: PresentationTextStyle,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SlideLayoutPlan {
    layout: PresentationLayout,
    density: ContentDensity,
    lines: Vec<PlannedTextLine>,
    images: Vec<PlannedPresentationImage>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PlannedPresentationImage {
    source: ArtifactAssetRefV1,
    fit: PresentationImageFitV1,
    bounds: SlideRect,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ExportArgs {
    #[serde(rename = "type")]
    artifact_type: ArtifactType,
    content: Value,
    output_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "content", rename_all = "snake_case")]
enum ArtifactDefinition {
    Document(DocumentArtifact),
    Presentation(PresentationArtifact),
}

impl ArtifactDefinition {
    fn artifact_type(&self) -> ArtifactType {
        match self {
            Self::Document(_) => ArtifactType::Document,
            Self::Presentation(_) => ArtifactType::Presentation,
        }
    }

    fn semantic_count(&self) -> usize {
        match self {
            Self::Document(document) => document.blocks.len(),
            Self::Presentation(presentation) => presentation.slides.len(),
        }
    }

    fn expected_text(&self) -> Vec<&str> {
        let mut expected = Vec::new();
        match self {
            Self::Document(document) => {
                if let Some(title) = &document.title {
                    expected.push(title.as_str());
                }
                for block in &document.blocks {
                    match block {
                        DocumentBlock::Heading { text, .. } | DocumentBlock::Paragraph { text } => {
                            expected.push(text.as_str())
                        }
                        DocumentBlock::BulletList { items } => {
                            expected.extend(items.iter().map(String::as_str));
                        }
                        DocumentBlock::Table { rows } => {
                            expected.extend(
                                rows.iter()
                                    .flatten()
                                    .filter(|cell| !cell.is_empty())
                                    .map(String::as_str),
                            );
                        }
                        DocumentBlock::SpreadsheetRange { .. } => {}
                        DocumentBlock::InlineImage { alt_text, .. } => {
                            if let Some(alt_text) = alt_text {
                                expected.push(alt_text.as_str());
                            }
                        }
                    }
                }
            }
            Self::Presentation(presentation) => {
                for slide in &presentation.slides {
                    expected.push(slide.title.as_str());
                    for region in &slide.regions {
                        for block in &region.blocks {
                            match block {
                                PresentationBlock::Paragraph { text } => {
                                    expected.push(text.as_str())
                                }
                                PresentationBlock::BulletList { items } => {
                                    expected.extend(items.iter().map(String::as_str));
                                }
                                PresentationBlock::Image { .. } => {}
                            }
                        }
                    }
                }
            }
        }
        expected
    }
}

struct ExportGuard<'a> {
    cancellation: &'a CommandCancellation,
    started: Instant,
}

impl<'a> ExportGuard<'a> {
    fn new(cancellation: &'a CommandCancellation) -> Self {
        Self {
            cancellation,
            started: Instant::now(),
        }
    }

    fn check(&self) -> Result<(), AgentError> {
        if self.cancellation.is_cancelled() {
            return Err(AgentError::Cancelled);
        }
        if self.started.elapsed() > EXPORT_DEADLINE {
            return Err(AgentError::CommandTimeout);
        }
        Ok(())
    }
}

struct RenderedArtifact {
    bytes: Vec<u8>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ExportStage {
    Validated,
    Rendered,
    BeforeAtomicWrite,
}

fn legacy_input_schema() -> Value {
    let document_block = json!({
        "oneOf":[
            {"type":"object","properties":{"kind":{"const":"HEADING"},"level":{"type":"integer","minimum":1,"maximum":3},"text":{"type":"string","minLength":1,"maxLength":16384}},"required":["kind","level","text"],"additionalProperties":false},
            {"type":"object","properties":{"kind":{"const":"PARAGRAPH"},"text":{"type":"string","minLength":1,"maxLength":16384}},"required":["kind","text"],"additionalProperties":false},
            {"type":"object","properties":{"kind":{"const":"BULLET_LIST"},"items":{"type":"array","minItems":1,"maxItems":64,"items":{"type":"string","minLength":1,"maxLength":16384}}},"required":["kind","items"],"additionalProperties":false},
            {"type":"object","properties":{"kind":{"const":"TABLE"},"rows":{"type":"array","minItems":1,"maxItems":64,"items":{"type":"array","minItems":1,"maxItems":16,"items":{"type":"string","maxLength":16384}}}},"required":["kind","rows"],"additionalProperties":false}
        ]
    });
    let presentation_block = json!({
        "oneOf":[
            {"type":"object","properties":{"kind":{"const":"PARAGRAPH"},"text":{"type":"string","minLength":1,"maxLength":16384}},"required":["kind","text"],"additionalProperties":false},
            {"type":"object","properties":{"kind":{"const":"BULLET_LIST"},"items":{"type":"array","minItems":1,"maxItems":64,"items":{"type":"string","minLength":1,"maxLength":16384}}},"required":["kind","items"],"additionalProperties":false}
        ]
    });
    let region = json!({
        "type":"object",
        "properties":{
            "slot":{"type":"string","enum":["BODY","LEFT","RIGHT"]},
            "blocks":{"type":"array","minItems":1,"maxItems":16,"items":presentation_block}
        },
        "required":["slot","blocks"],
        "additionalProperties":false
    });
    json!({
        "type":"object",
        "properties":{
            "type":{"type":"string","enum":["document","presentation"]},
            "content":{"oneOf":[
                {
                    "type":"object",
                    "properties":{
                        "title":{"type":"string","minLength":1,"maxLength":16384},
                        "blocks":{"type":"array","minItems":1,"maxItems":256,"items":document_block}
                    },
                    "required":["blocks"],
                    "additionalProperties":false
                },
                {
                    "type":"object",
                    "properties":{
                        "slides":{"type":"array","minItems":1,"maxItems":32,"items":{
                            "type":"object",
                            "properties":{
                                "layout":{"type":"string","enum":["TITLE","TITLE_AND_BODY","TWO_COLUMN"]},
                                "title":{"type":"string","minLength":1,"maxLength":16384},
                                "regions":{"type":"array","maxItems":3,"items":region}
                            },
                            "required":["layout","title"],
                            "additionalProperties":false
                        }}
                    },
                    "required":["slides"],
                    "additionalProperties":false
                }
            ]},
            "output_path":{"type":"string","minLength":1,"maxLength":4096}
        },
        "required":["type","content","output_path"],
        "additionalProperties":false
    })
}

fn diagram_content_schema() -> Value {
    let local_id = json!({
        "type":"string",
        "minLength":1,
        "maxLength":64,
        "pattern":"^[a-z][a-z0-9_-]{0,63}$"
    });
    let emphasis = json!({"type":"string","enum":["NORMAL","EMPHASIS"]});
    let node = json!({
        "type":"object",
        "properties":{
            "node_id":local_id.clone(),
            "label":{"type":"string","minLength":1,"maxLength":120},
            "description":{"type":"string","minLength":1,"maxLength":1024},
            "semantic_kind":{"type":"string","enum":["GENERIC","PERSON","SYSTEM","SERVICE","DATABASE","PROCESS","DOCUMENT"]},
            "presentation":{
                "type":"object",
                "properties":{
                    "shape":{"type":"string","enum":["AUTO","RECTANGLE","ROUNDED_RECT","ELLIPSE"]},
                    "emphasis":emphasis.clone()
                },
                "required":["shape","emphasis"],
                "additionalProperties":false
            }
        },
        "required":["node_id","label","semantic_kind"],
        "additionalProperties":false
    });
    let edge = json!({
        "type":"object",
        "properties":{
            "edge_id":local_id.clone(),
            "source_node_id":local_id.clone(),
            "target_node_id":local_id.clone(),
            "label":{"type":"string","minLength":1,"maxLength":120},
            "relation_kind":{"type":"string","enum":["RELATION","FLOW","DEPENDS_ON","CONTAINS"]},
            "direction":{"type":"string","enum":["FORWARD","BIDIRECTIONAL","NONE"]},
            "presentation":{
                "type":"object",
                "properties":{"emphasis":emphasis},
                "required":["emphasis"],
                "additionalProperties":false
            }
        },
        "required":["edge_id","source_node_id","target_node_id","relation_kind","direction"],
        "additionalProperties":false
    });
    let group = json!({
        "type":"object",
        "properties":{
            "group_id":local_id.clone(),
            "label":{"type":"string","minLength":1,"maxLength":120},
            "semantic_kind":{"type":"string","enum":["BOUNDARY","LAYER","CLUSTER"]},
            "member_node_ids":{"type":"array","minItems":1,"maxItems":64,"items":local_id}
        },
        "required":["group_id","label","semantic_kind","member_node_ids"],
        "additionalProperties":false
    });
    json!({
        "type":"object",
        "properties":{
            "title":{"type":"string","minLength":1,"maxLength":120},
            "description":{"type":"string","minLength":1,"maxLength":1024},
            "layout":{
                "type":"object",
                "properties":{
                    "strategy":{"const":"LAYERED_AUTO"},
                    "direction":{"type":"string","enum":["LEFT_TO_RIGHT","TOP_TO_BOTTOM"]}
                },
                "required":["strategy","direction"],
                "additionalProperties":false
            },
            "nodes":{"type":"array","minItems":1,"maxItems":64,"items":node},
            "edges":{"type":"array","maxItems":128,"items":edge},
            "groups":{"type":"array","maxItems":16,"items":group}
        },
        "required":["layout","nodes","edges","groups"],
        "additionalProperties":false
    })
}

fn spreadsheet_content_schema() -> Value {
    let sheet_id = json!({
        "type":"string",
        "minLength":1,
        "maxLength":64,
        "pattern":"^[a-z][a-z0-9_-]{0,63}$"
    });
    let literal = json!({
        "oneOf":[
            {
                "type":"object",
                "properties":{
                    "kind":{"const":"STRING"},
                    "value":{"type":"string","minLength":1,"maxLength":1024}
                },
                "required":["kind","value"],
                "additionalProperties":false
            },
            {
                "type":"object",
                "properties":{
                    "kind":{"const":"DECIMAL"},
                    "value":{"type":"string","minLength":1,"maxLength":32,"pattern":"^-?[0-9]+(?:\\.[0-9]+)?$"}
                },
                "required":["kind","value"],
                "additionalProperties":false
            },
            {
                "type":"object",
                "properties":{
                    "kind":{"const":"BOOLEAN"},
                    "value":{"type":"boolean"}
                },
                "required":["kind","value"],
                "additionalProperties":false
            }
        ]
    });
    let presentation = json!({
        "type":"object",
        "properties":{
            "emphasis":{"type":"string","enum":["NORMAL","HEADER","TOTAL"]},
            "alignment":{"type":"string","enum":["AUTO","LEFT","CENTER","RIGHT"]},
            "wrap":{"type":"boolean"}
        },
        "required":["emphasis","alignment","wrap"],
        "additionalProperties":false
    });
    let cell = json!({
        "type":"object",
        "properties":{
            "row":{"type":"integer","minimum":1,"maximum":2000},
            "column":{"type":"integer","minimum":1,"maximum":256},
            "value":literal,
            "format":{"type":"string","enum":["GENERAL","TEXT","INTEGER","DECIMAL_2","PERCENT_2"]},
            "presentation":presentation
        },
        "required":["row","column","value"],
        "additionalProperties":false
    });
    let sheet = json!({
        "type":"object",
        "properties":{
            "sheet_id":sheet_id,
            "name":{"type":"string","minLength":1,"maxLength":31},
            "cells":{"type":"array","maxItems":4096,"items":cell}
        },
        "required":["sheet_id","name","cells"],
        "additionalProperties":false
    });
    json!({
        "type":"object",
        "properties":{
            "title":{"type":"string","minLength":1,"maxLength":120},
            "sheets":{"type":"array","minItems":1,"maxItems":32,"items":sheet}
        },
        "required":["sheets"],
        "additionalProperties":false
    })
}

fn durable_content_schema() -> Value {
    let legacy = legacy_input_schema();
    let mut variants = legacy["properties"]["content"]["oneOf"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let spreadsheet_range = json!({
        "type":"object",
        "properties":{
            "kind":{"const":"SPREADSHEET_RANGE"},
            "source":{
                "type":"object",
                "properties":{
                    "artifact_ref":{
                        "type":"object",
                        "properties":{
                            "artifact_id":{"type":"string","minLength":1,"maxLength":128},
                            "revision_id":{"type":"string","minLength":1,"maxLength":128},
                            "expected_type":{"const":"SPREADSHEET"},
                            "semantic_sha256":{"type":"string","pattern":"^[0-9a-f]{64}$"}
                        },
                        "required":["artifact_id","revision_id","expected_type","semantic_sha256"],
                        "additionalProperties":false
                    },
                    "sheet_id":{"type":"string","minLength":1,"maxLength":64,"pattern":"^[a-z][a-z0-9_-]{0,63}$"},
                    "start_row":{"type":"integer","minimum":1,"maximum":2000},
                    "start_column":{"type":"integer","minimum":1,"maximum":256},
                    "end_row":{"type":"integer","minimum":1,"maximum":2000},
                    "end_column":{"type":"integer","minimum":1,"maximum":256}
                },
                "required":["artifact_ref","sheet_id","start_row","start_column","end_row","end_column"],
                "additionalProperties":false
            }
        },
        "required":["kind","source"],
        "additionalProperties":false
    });
    let inline_image = json!({
        "type":"object",
        "properties":{
            "kind":{"const":"INLINE_IMAGE"},
            "source":{
                "type":"object",
                "properties":{
                    "asset_id":{"type":"string","minLength":1,"maxLength":128},
                    "content_sha256":{"type":"string","pattern":"^[0-9a-f]{64}$"},
                    "media_type":{"const":"image/png"},
                    "byte_length":{"type":"integer","minimum":1,"maximum":8388608}
                },
                "required":["asset_id","content_sha256","media_type","byte_length"],
                "additionalProperties":false
            },
            "size_intent":{"const":"DOCUMENT_WIDTH_BOUNDED"},
            "alt_text":{"type":"string","minLength":1,"maxLength":1024}
        },
        "required":["kind","source","size_intent"],
        "additionalProperties":false
    });
    let presentation_image = json!({
        "type":"object",
        "properties":{
            "kind":{"const":"IMAGE"},
            "source":{
                "type":"object",
                "properties":{
                    "asset_id":{"type":"string","minLength":1,"maxLength":128},
                    "content_sha256":{"type":"string","pattern":"^[0-9a-f]{64}$"},
                    "media_type":{"const":"image/png"},
                    "byte_length":{"type":"integer","minimum":1,"maximum":8388608}
                },
                "required":["asset_id","content_sha256","media_type","byte_length"],
                "additionalProperties":false
            },
            "fit":{"const":"CONTAIN"}
        },
        "required":["kind","source","fit"],
        "additionalProperties":false
    });
    variants[0]["properties"]["blocks"]["items"]["oneOf"]
        .as_array_mut()
        .expect("Document block schema must remain a oneOf")
        .push(spreadsheet_range);
    variants[0]["properties"]["blocks"]["items"]["oneOf"]
        .as_array_mut()
        .expect("Document block schema must remain a oneOf")
        .push(inline_image);
    variants[1]["properties"]["slides"]["items"]["properties"]["regions"]["items"]
        ["properties"]["blocks"]["items"]["oneOf"]
        .as_array_mut()
        .expect("Presentation block schema must remain a oneOf")
        .push(presentation_image);
    variants.push(diagram_content_schema());
    variants.push(spreadsheet_content_schema());
    json!({"oneOf":variants})
}

pub fn input_schema() -> Value {
    json!({
        "oneOf":[
            legacy_input_schema(),
            {
                "type":"object",
                "properties":{
                    "artifact_id":{"type":"string","minLength":1,"maxLength":128},
                    "revision_id":{"type":"string","minLength":1,"maxLength":128},
                    "output_path":{"type":"string","minLength":1,"maxLength":4096}
                },
                "required":["artifact_id","output_path"],
                "additionalProperties":false
            }
        ]
    })
}

pub fn create_input_schema() -> Value {
    json!({
        "type":"object",
        "properties":{
            "type":{"type":"string","enum":["document","presentation","diagram","spreadsheet"]},
            "title":{"type":"string","minLength":1,"maxLength":512},
            "content":durable_content_schema(),
            "associate_with_current_project":{"type":"boolean"}
        },
        "required":["type","content"],
        "additionalProperties":false
    })
}

pub fn update_input_schema() -> Value {
    json!({
        "type":"object",
        "properties":{
            "artifact_id":{"type":"string","minLength":1,"maxLength":128},
            "expected_revision_id":{"type":"string","minLength":1,"maxLength":128},
            "content":durable_content_schema()
        },
        "required":["artifact_id","expected_revision_id","content"],
        "additionalProperties":false
    })
}

pub fn read_input_schema() -> Value {
    json!({
        "type":"object",
        "properties":{
            "artifact_id":{"type":"string","minLength":1,"maxLength":128},
            "revision_id":{"type":"string","minLength":1,"maxLength":128}
        },
        "required":["artifact_id"],
        "additionalProperties":false
    })
}

pub fn list_input_schema() -> Value {
    json!({
        "type":"object",
        "properties":{
            "limit":{"type":"integer","minimum":1,"maximum":100},
            "include_archived":{"type":"boolean"},
            "cursor":{
                "type":"object",
                "properties":{
                    "updated_at":{"type":"integer"},
                    "artifact_id":{"type":"string","minLength":1,"maxLength":128}
                },
                "required":["updated_at","artifact_id"],
                "additionalProperties":false
            }
        },
        "additionalProperties":false
    })
}

pub fn history_input_schema() -> Value {
    json!({
        "type":"object",
        "properties":{
            "artifact_id":{"type":"string","minLength":1,"maxLength":128},
            "before_sequence":{"type":"integer","minimum":2},
            "limit":{"type":"integer","minimum":1,"maximum":100}
        },
        "required":["artifact_id"],
        "additionalProperties":false
    })
}

pub fn archive_input_schema() -> Value {
    json!({
        "type":"object",
        "properties":{
            "artifact_id":{"type":"string","minLength":1,"maxLength":128},
            "archived":{"type":"boolean"}
        },
        "required":["artifact_id","archived"],
        "additionalProperties":false
    })
}

#[derive(Debug, Clone, PartialEq)]
pub struct CanonicalArtifactContent {
    pub content: ArtifactContentV1,
    pub canonical_json: String,
    pub semantic_sha256: String,
    pub semantic_unit_count: usize,
}

/// Render one admitted Diagram semantic model through the same deterministic
/// renderer and structural reopen validation used by durable SVG export. The
/// returned bytes are transient preview bytes; they are never artifact source
/// of truth and are not written to the project.
pub fn render_diagram_preview(diagram: &DiagramArtifactV1) -> Result<Vec<u8>, AgentError> {
    let rendered = diagram::render(diagram)?;
    diagram::reopen(&rendered, &rendered.bytes)?;
    Ok(rendered.bytes)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ArtifactDependencyFact {
    pub child_artifact_id: ArtifactId,
    pub child_revision_id: ArtifactRevisionId,
    pub expected_type: DurableArtifactType,
    pub semantic_sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedDocumentComposition {
    pub document: DocumentArtifact,
    pub dependencies: Vec<ArtifactDependencyFact>,
    pub dependency_set_sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ArtifactAssetFact {
    pub asset_id: fielora_contracts::AssetId,
    pub content_sha256: String,
    pub media_type: AssetMediaType,
    pub byte_length: u64,
    pub width: u32,
    pub height: u32,
    #[serde(skip_serializing)]
    pub blob_ref: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedArtifactAssets {
    pub assets: Vec<ArtifactAssetFact>,
    pub asset_set_sha256: String,
    pub reference_count: usize,
}

/// Resolves and pins profile-scoped immutable Asset metadata. The caller owns
/// storage scoping; missing and cross-profile IDs intentionally share one
/// outward error.
pub fn resolve_artifact_assets<F>(
    content: &ArtifactContentV1,
    mut read_asset: F,
) -> Result<ResolvedArtifactAssets, AgentError>
where
    F: FnMut(&fielora_contracts::AssetId) -> Result<AssetView, AgentError>,
{
    let references = match content {
        ArtifactContentV1::Document(document) => document
            .blocks
            .iter()
            .filter_map(|block| match block {
                DocumentBlock::InlineImage { source, .. } => Some(source),
                _ => None,
            })
            .collect::<Vec<_>>(),
        ArtifactContentV1::Presentation(presentation) => presentation
            .slides
            .iter()
            .flat_map(|slide| &slide.regions)
            .flat_map(|region| &region.blocks)
            .filter_map(|block| match block {
                PresentationBlock::Image { source, .. } => Some(source),
                _ => None,
            })
            .collect::<Vec<_>>(),
        ArtifactContentV1::Diagram(_)
        | ArtifactContentV1::Spreadsheet(_)
        | ArtifactContentV1::FileMutation(_) => Vec::new(),
    };
    if references.len() > MAX_ASSETS_PER_REVISION {
        return Err(AgentError::ArtifactCompositionLimitExceeded);
    }
    let mut unique = BTreeMap::<String, ArtifactAssetFact>::new();
    for reference in &references {
        validate_asset_ref(reference)?;
        if let Some(existing) = unique.get(&reference.asset_id.0) {
            if existing.content_sha256 != reference.content_sha256
                || existing.media_type != reference.media_type
                || existing.byte_length != reference.byte_length
            {
                return Err(AgentError::ArtifactReferenceIntegrityFailed);
            }
            continue;
        }
        let asset = read_asset(&reference.asset_id)?;
        if asset.asset_id != reference.asset_id
            || asset.media_type != AssetMediaType::Png
            || asset.media_type != reference.media_type
            || asset.content_sha256 != reference.content_sha256
            || asset.byte_length != reference.byte_length
            || asset.width == 0
            || asset.width > 4096
            || asset.height == 0
            || asset.height > 4096
            || u64::from(asset.width) * u64::from(asset.height) > 16_777_216
        {
            return Err(AgentError::ArtifactReferenceIntegrityFailed);
        }
        unique.insert(
            reference.asset_id.0.clone(),
            ArtifactAssetFact {
                asset_id: asset.asset_id,
                content_sha256: asset.content_sha256,
                media_type: asset.media_type,
                byte_length: asset.byte_length,
                width: asset.width,
                height: asset.height,
                blob_ref: asset.blob_ref,
            },
        );
    }
    let assets = unique.into_values().collect::<Vec<_>>();
    let digest_input = assets
        .iter()
        .map(|asset| {
            json!({
                "asset_id":asset.asset_id,
                "content_sha256":asset.content_sha256,
                "media_type":asset.media_type,
            })
        })
        .collect::<Vec<_>>();
    let encoded = serde_json::to_vec(&digest_input).map_err(|_| AgentError::IoFailed)?;
    Ok(ResolvedArtifactAssets {
        assets,
        asset_set_sha256: sha256(&encoded),
        reference_count: references.len(),
    })
}

fn validate_asset_ref(reference: &ArtifactAssetRefV1) -> Result<(), AgentError> {
    if reference.asset_id.0.is_empty()
        || reference.asset_id.0.len() > 128
        || reference.media_type != AssetMediaType::Png
        || reference.byte_length == 0
        || reference.byte_length > 8 * 1024 * 1024
        || reference.content_sha256.len() != 64
        || !reference
            .content_sha256
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(AgentError::ArtifactReferenceIntegrityFailed);
    }
    Ok(())
}

/// Resolves exact Artifact revisions into one immutable render-preparation
/// snapshot. The caller owns profile scoping; this service has no storage,
/// network, model, permission, or mutation authority.
pub fn resolve_document_composition<F>(
    document: &DocumentArtifact,
    mut read_exact: F,
) -> Result<ResolvedDocumentComposition, AgentError>
where
    F: FnMut(&ArtifactId, &ArtifactRevisionId) -> Result<ArtifactReadView, AgentError>,
{
    let references = document
        .blocks
        .iter()
        .filter_map(|block| match block {
            DocumentBlock::SpreadsheetRange { source } => Some(source),
            _ => None,
        })
        .collect::<Vec<_>>();
    if references.len() > MAX_REFERENCES_PER_REVISION {
        return Err(AgentError::ArtifactCompositionLimitExceeded);
    }

    let mut snapshot = BTreeMap::new();
    let mut dependencies = BTreeMap::new();
    for source in &references {
        admit_spreadsheet_range(source)?;
        let reference = &source.artifact_ref;
        if reference.expected_type != DurableArtifactType::Spreadsheet {
            return Err(AgentError::ArtifactReferenceTypeMismatch);
        }
        let node = (
            reference.artifact_id.0.clone(),
            reference.revision_id.0.clone(),
        );
        if !snapshot.contains_key(&node) {
            if snapshot.len() >= MAX_TRANSITIVE_DEPENDENCIES {
                return Err(AgentError::ArtifactCompositionLimitExceeded);
            }
            let child = read_exact(&reference.artifact_id, &reference.revision_id)?;
            validate_exact_dependency(reference, &child)?;
            snapshot.insert(node.clone(), child);
        }
        dependencies.insert(
            node,
            ArtifactDependencyFact {
                child_artifact_id: reference.artifact_id.clone(),
                child_revision_id: reference.revision_id.clone(),
                expected_type: reference.expected_type,
                semantic_sha256: reference.semantic_sha256.clone(),
            },
        );
    }

    let graph = snapshot
        .keys()
        .cloned()
        .map(|node| (node, Vec::new()))
        .collect::<BTreeMap<_, _>>();
    let roots = references
        .iter()
        .map(|source| {
            (
                source.artifact_ref.artifact_id.0.clone(),
                source.artifact_ref.revision_id.0.clone(),
            )
        })
        .collect::<Vec<_>>();
    validate_dependency_graph(&graph, &roots)?;

    let mut blocks = Vec::with_capacity(document.blocks.len());
    for block in &document.blocks {
        match block {
            DocumentBlock::SpreadsheetRange { source } => {
                let node = (
                    source.artifact_ref.artifact_id.0.clone(),
                    source.artifact_ref.revision_id.0.clone(),
                );
                let child = snapshot
                    .get(&node)
                    .ok_or(AgentError::ArtifactReferenceNotFound)?;
                blocks.push(DocumentBlock::Table {
                    rows: materialize_spreadsheet_range(source, child)?,
                });
            }
            other => blocks.push(other.clone()),
        }
    }
    let document = DocumentArtifact {
        title: document.title.clone(),
        blocks,
    };
    validate_definition(&ArtifactDefinition::Document(document.clone())).map_err(|error| {
        if error == AgentError::ToolArgumentsInvalid {
            AgentError::ArtifactCompositionLimitExceeded
        } else {
            error
        }
    })?;

    let dependencies = dependencies.into_values().collect::<Vec<_>>();
    let encoded = serde_json::to_vec(&dependencies).map_err(|_| AgentError::IoFailed)?;
    Ok(ResolvedDocumentComposition {
        document,
        dependencies,
        dependency_set_sha256: sha256(&encoded),
    })
}

fn validate_dependency_graph(
    graph: &BTreeMap<(String, String), Vec<(String, String)>>,
    roots: &[(String, String)],
) -> Result<(), AgentError> {
    fn visit(
        node: &(String, String),
        graph: &BTreeMap<(String, String), Vec<(String, String)>>,
        depth: usize,
        active: &mut BTreeSet<(String, String)>,
        visited: &mut BTreeSet<(String, String)>,
    ) -> Result<(), AgentError> {
        if depth > MAX_COMPOSITION_DEPTH {
            return Err(AgentError::ArtifactCompositionLimitExceeded);
        }
        if active.contains(node) {
            return Err(AgentError::ArtifactCompositionCycle);
        }
        if visited.contains(node) {
            return Ok(());
        }
        if visited.len() >= MAX_TRANSITIVE_DEPENDENCIES {
            return Err(AgentError::ArtifactCompositionLimitExceeded);
        }
        active.insert(node.clone());
        for child in graph.get(node).into_iter().flatten() {
            visit(child, graph, depth + 1, active, visited)?;
        }
        active.remove(node);
        visited.insert(node.clone());
        Ok(())
    }

    let mut active = BTreeSet::new();
    let mut visited = BTreeSet::new();
    for root in roots {
        visit(root, graph, 1, &mut active, &mut visited)?;
    }
    Ok(())
}

fn admit_spreadsheet_range(source: &SpreadsheetRangeEmbedV1) -> Result<(), AgentError> {
    let rows = source
        .end_row
        .checked_sub(source.start_row)
        .and_then(|value| value.checked_add(1))
        .ok_or(AgentError::ArtifactReferenceRangeInvalid)?;
    let columns = source
        .end_column
        .checked_sub(source.start_column)
        .and_then(|value| value.checked_add(1))
        .ok_or(AgentError::ArtifactReferenceRangeInvalid)?;
    let cells = usize::try_from(rows)
        .ok()
        .and_then(|rows| rows.checked_mul(usize::from(columns)))
        .ok_or(AgentError::ArtifactReferenceRangeInvalid)?;
    if source.start_row == 0
        || source.start_column == 0
        || source.end_row > 2_000
        || source.end_column > 256
        || rows as usize > MAX_TABLE_ROWS
        || usize::from(columns) > MAX_TABLE_COLUMNS
        || cells > MAX_RANGE_CELLS
    {
        return Err(AgentError::ArtifactReferenceRangeInvalid);
    }
    Ok(())
}

fn validate_exact_dependency(
    reference: &fielora_contracts::ArtifactRefV1,
    child: &ArtifactReadView,
) -> Result<(), AgentError> {
    if child.artifact.artifact_id != reference.artifact_id
        || child.revision.artifact_id != reference.artifact_id
        || child.revision.revision_id != reference.revision_id
    {
        return Err(AgentError::ArtifactReferenceNotFound);
    }
    if child.artifact.artifact_type != reference.expected_type
        || child.revision.content.artifact_type() != reference.expected_type
    {
        return Err(AgentError::ArtifactReferenceTypeMismatch);
    }
    if child.revision.semantic_sha256 != reference.semantic_sha256 {
        return Err(AgentError::ArtifactReferenceIntegrityFailed);
    }
    let canonical_json = serde_json::to_vec(&child.revision.content)
        .map_err(|_| AgentError::ArtifactContentInvalid)?;
    if canonical_json.len() > MAX_CHILD_SEMANTIC_JSON_BYTES
        || sha256(&canonical_json) != child.revision.semantic_sha256
    {
        return Err(AgentError::ArtifactReferenceIntegrityFailed);
    }
    Ok(())
}

fn materialize_spreadsheet_range(
    source: &SpreadsheetRangeEmbedV1,
    child: &ArtifactReadView,
) -> Result<Vec<Vec<String>>, AgentError> {
    let ArtifactContentV1::Spreadsheet(workbook) = &child.revision.content else {
        return Err(AgentError::ArtifactReferenceTypeMismatch);
    };
    let sheet = workbook
        .sheets
        .iter()
        .find(|sheet| sheet.sheet_id == source.sheet_id)
        .ok_or(AgentError::ArtifactReferenceRangeInvalid)?;
    let cells = sheet
        .cells
        .iter()
        .map(|cell| {
            (
                (cell.row, cell.column),
                spreadsheet::display_text(&cell.value),
            )
        })
        .collect::<BTreeMap<_, _>>();
    let mut rows = Vec::new();
    for row in source.start_row..=source.end_row {
        let mut values = Vec::new();
        for column in source.start_column..=source.end_column {
            values.push(cells.get(&(row, column)).cloned().unwrap_or_default());
        }
        rows.push(values);
    }
    Ok(rows)
}

pub fn canonicalize_content(
    artifact_type: DurableArtifactType,
    content: Value,
) -> Result<CanonicalArtifactContent, AgentError> {
    if !content.is_object() {
        let actual = match &content {
            Value::String(_) => "string",
            Value::Array(_) => "array",
            Value::Null => "null",
            Value::Bool(_) => "boolean",
            Value::Number(_) => "number",
            Value::Object(_) => unreachable!(),
        };
        return Err(AgentError::WorkGuidance {
            code: "ARTIFACT_CONTENT_INVALID",
            detail: format!(
                "Field content: expected a JSON object, received {actual}. Pass content as an object directly, not a JSON-encoded string. Changing keys inside a string cannot fix this outer type error. Inspect this tool's input schema; do not substitute a Skill's independent JSON format."
            ),
        });
    }
    let definition = match artifact_type {
        DurableArtifactType::Document => serde_json::from_value(content)
            .map(ArtifactDefinition::Document)
            .map_err(|_| AgentError::ArtifactContentInvalid)?,
        DurableArtifactType::Presentation => serde_json::from_value(content)
            .map(ArtifactDefinition::Presentation)
            .map_err(|_| AgentError::ArtifactContentInvalid)?,
        DurableArtifactType::Diagram => {
            let mut diagram: DiagramArtifactV1 =
                serde_json::from_value(content).map_err(|_| AgentError::ArtifactContentInvalid)?;
            let facts = diagram::canonicalize(&mut diagram)?;
            let content = ArtifactContentV1::Diagram(diagram);
            let canonical_json =
                serde_json::to_string(&content).map_err(|_| AgentError::ArtifactContentInvalid)?;
            if canonical_json.len() > MAX_DEFINITION_BYTES {
                return Err(AgentError::ArtifactContentInvalid);
            }
            return Ok(CanonicalArtifactContent {
                semantic_sha256: sha256(canonical_json.as_bytes()),
                content,
                canonical_json,
                semantic_unit_count: facts.node_count + facts.edge_count + facts.group_count,
            });
        }
        DurableArtifactType::Spreadsheet => {
            let mut workbook: SpreadsheetArtifactV1 =
                serde_json::from_value(content).map_err(|_| AgentError::ArtifactContentInvalid)?;
            let facts = spreadsheet::canonicalize(&mut workbook)?;
            let content = ArtifactContentV1::Spreadsheet(workbook);
            let canonical_json =
                serde_json::to_string(&content).map_err(|_| AgentError::ArtifactContentInvalid)?;
            if canonical_json.len() > MAX_DEFINITION_BYTES {
                return Err(AgentError::ArtifactContentInvalid);
            }
            return Ok(CanonicalArtifactContent {
                semantic_sha256: sha256(canonical_json.as_bytes()),
                content,
                canonical_json,
                semantic_unit_count: facts.sheet_count + facts.cell_count,
            });
        }
        // FILE_MUTATION is committed only from trusted Tool receipts by the
        // Harness wrapper; it is intentionally absent from model create/update.
        DurableArtifactType::FileMutation => return Err(AgentError::ArtifactContentInvalid),
    };
    validate_definition(&definition).map_err(|_| AgentError::ArtifactContentInvalid)?;
    let semantic_unit_count = definition.semantic_count();
    let content = match definition {
        ArtifactDefinition::Document(value) => ArtifactContentV1::Document(value),
        ArtifactDefinition::Presentation(value) => ArtifactContentV1::Presentation(value),
    };
    let canonical_json =
        serde_json::to_string(&content).map_err(|_| AgentError::ArtifactContentInvalid)?;
    if canonical_json.len() > MAX_DEFINITION_BYTES {
        return Err(AgentError::ArtifactContentInvalid);
    }
    let semantic_sha256 = sha256(canonical_json.as_bytes());
    Ok(CanonicalArtifactContent {
        content,
        canonical_json,
        semantic_sha256,
        semantic_unit_count,
    })
}

pub fn export_saved(
    runtime: &ToolRuntime,
    artifact: &ArtifactReadView,
    output_path: &str,
    cancellation: &CommandCancellation,
) -> Result<ToolExecution, AgentError> {
    if matches!(&artifact.revision.content, ArtifactContentV1::Diagram(_)) {
        return export_saved_diagram(runtime, artifact, output_path, cancellation);
    }
    if matches!(
        &artifact.revision.content,
        ArtifactContentV1::Spreadsheet(_)
    ) {
        return export_saved_spreadsheet(runtime, artifact, output_path, cancellation);
    }
    let (artifact_type, content) = match &artifact.revision.content {
        ArtifactContentV1::Document(value) => (
            "document",
            serde_json::to_value(value).map_err(|_| AgentError::ArtifactContentInvalid)?,
        ),
        ArtifactContentV1::Presentation(value) => (
            "presentation",
            serde_json::to_value(value).map_err(|_| AgentError::ArtifactContentInvalid)?,
        ),
        ArtifactContentV1::Diagram(_) => unreachable!("Diagram export is dispatched above"),
        ArtifactContentV1::Spreadsheet(_) => {
            unreachable!("Spreadsheet export is dispatched above")
        }
        ArtifactContentV1::FileMutation(_) => return Err(AgentError::ArtifactContentInvalid),
    };
    let mut execution = export(
        runtime,
        &json!({"type":artifact_type,"content":content,"output_path":output_path}),
        cancellation,
    )?;
    if let Some(receipt) = execution.receipt.as_object_mut() {
        receipt.insert("artifact_id".into(), json!(artifact.artifact.artifact_id));
        receipt.insert(
            "artifact_revision_id".into(),
            json!(artifact.revision.revision_id),
        );
        receipt.insert(
            "exported_revision_id".into(),
            json!(artifact.revision.revision_id),
        );
        receipt.insert(
            "artifact_revision".into(),
            json!(artifact.revision.sequence),
        );
        receipt.insert("artifact_persistence".into(), json!("DURABLE"));
        receipt.insert(
            "artifact_semantic_sha256".into(),
            json!(artifact.revision.semantic_sha256),
        );
    }
    let receipt = &execution.receipt;
    execution.observation = json!({
        "artifact_id":artifact.artifact.artifact_id,
        "artifact_revision_id":artifact.revision.revision_id,
        "artifact_revision":artifact.revision.sequence,
        "artifact_persistence":"DURABLE",
        "path":receipt.get("path"),
        "output_bytes":receipt.get("output_bytes"),
        "output_sha256":receipt.get("output_sha256"),
        "structural_reopen":"STRUCTURAL_VALID",
        "roundtrip":"SEMANTIC_CONTENT_PRESENT",
        "visual_compatibility":"NOT_VERIFIED"
    })
    .to_string();
    Ok(execution)
}

pub fn export_saved_document_composition(
    runtime: &ToolRuntime,
    artifact: &ArtifactReadView,
    resolved: &ResolvedDocumentComposition,
    output_path: &str,
    cancellation: &CommandCancellation,
) -> Result<ToolExecution, AgentError> {
    let empty = ResolvedArtifactAssets {
        assets: Vec::new(),
        asset_set_sha256: sha256(b"[]"),
        reference_count: 0,
    };
    export_saved_document_composition_with_assets(
        runtime,
        artifact,
        resolved,
        &empty,
        output_path,
        cancellation,
    )
}

pub fn export_saved_document_composition_with_assets(
    runtime: &ToolRuntime,
    artifact: &ArtifactReadView,
    resolved: &ResolvedDocumentComposition,
    resolved_assets: &ResolvedArtifactAssets,
    output_path: &str,
    cancellation: &CommandCancellation,
) -> Result<ToolExecution, AgentError> {
    if !matches!(artifact.revision.content, ArtifactContentV1::Document(_)) {
        return Err(AgentError::ArtifactContentInvalid);
    }
    let snapshot = resolve_png_snapshots(runtime, resolved_assets)?;
    let definition = ArtifactDefinition::Document(resolved.document.clone());
    let expected_media = expected_document_media(&resolved.document, &snapshot)?;
    let arguments = json!({
        "type":"document",
        "content":resolved.document,
        "output_path":output_path,
    });
    let mut execution = export_with_validation(
        runtime,
        &arguments,
        cancellation,
        |_| render_document_with_assets(&resolved.document, &snapshot),
        |definition, bytes| {
            validate_rendered(definition, bytes)?;
            validate_docx_png_media(bytes, &expected_media)
        },
        |_, _| {},
    )?;
    // The specialized renderer is still constrained to the exact canonical
    // resolved Document definition used by the generic export envelope.
    if definition.semantic_count() != resolved.document.blocks.len() {
        return Err(AgentError::ArtifactContentInvalid);
    }
    let base_receipt = execution
        .receipt
        .as_object_mut()
        .ok_or(AgentError::IoFailed)?;
    base_receipt.insert("artifact_id".into(), json!(artifact.artifact.artifact_id));
    base_receipt.insert(
        "artifact_revision_id".into(),
        json!(artifact.revision.revision_id),
    );
    base_receipt.insert(
        "exported_revision_id".into(),
        json!(artifact.revision.revision_id),
    );
    base_receipt.insert(
        "artifact_revision".into(),
        json!(artifact.revision.sequence),
    );
    base_receipt.insert("artifact_persistence".into(), json!("DURABLE"));
    base_receipt.insert(
        "artifact_semantic_sha256".into(),
        json!(artifact.revision.semantic_sha256),
    );
    base_receipt.insert("asset_count".into(), json!(resolved_assets.reference_count));
    base_receipt.insert(
        "unique_asset_count".into(),
        json!(resolved_assets.assets.len()),
    );
    base_receipt.insert(
        "asset_set_sha256".into(),
        json!(resolved_assets.asset_set_sha256),
    );
    base_receipt.insert("assets".into(), json!(resolved_assets.assets));
    base_receipt.insert(
        "asset_export_revalidation".into(),
        json!("LENGTH_SHA256_AND_STATIC_PNG_STRUCTURE"),
    );
    let receipt = execution
        .receipt
        .as_object_mut()
        .ok_or(AgentError::IoFailed)?;
    receipt.insert(
        "dependency_count".into(),
        json!(resolved.dependencies.len()),
    );
    receipt.insert(
        "dependency_set_sha256".into(),
        json!(resolved.dependency_set_sha256),
    );
    receipt.insert("dependencies".into(), json!(resolved.dependencies));
    if serde_json::to_vec(&execution.receipt)
        .map_err(|_| AgentError::IoFailed)?
        .len()
        > MAX_TOOL_RESULT_BYTES
    {
        return Err(AgentError::IoFailed);
    }
    Ok(execution)
}

pub fn export_saved_presentation_with_assets(
    runtime: &ToolRuntime,
    artifact: &ArtifactReadView,
    resolved_assets: &ResolvedArtifactAssets,
    output_path: &str,
    cancellation: &CommandCancellation,
) -> Result<ToolExecution, AgentError> {
    let ArtifactContentV1::Presentation(presentation) = &artifact.revision.content else {
        return Err(AgentError::ArtifactContentInvalid);
    };
    let snapshot = resolve_png_snapshots(runtime, resolved_assets)?;
    let plans = plan_presentation(presentation)?;
    let expected_media = expected_presentation_media(&plans, &snapshot)?;
    let arguments = json!({
        "type":"presentation",
        "content":presentation,
        "output_path":output_path,
    });
    let mut execution = export_with_validation(
        runtime,
        &arguments,
        cancellation,
        |_| render_presentation_with_assets(presentation, &plans, &snapshot),
        |definition, bytes| {
            validate_rendered(definition, bytes)?;
            validate_pptx_png_media(bytes, &expected_media)
        },
        |_, _| {},
    )?;
    let receipt = execution
        .receipt
        .as_object_mut()
        .ok_or(AgentError::IoFailed)?;
    receipt.insert("artifact_id".into(), json!(artifact.artifact.artifact_id));
    receipt.insert(
        "artifact_revision_id".into(),
        json!(artifact.revision.revision_id),
    );
    receipt.insert(
        "exported_revision_id".into(),
        json!(artifact.revision.revision_id),
    );
    receipt.insert(
        "artifact_revision".into(),
        json!(artifact.revision.sequence),
    );
    receipt.insert("artifact_persistence".into(), json!("DURABLE"));
    receipt.insert(
        "artifact_semantic_sha256".into(),
        json!(artifact.revision.semantic_sha256),
    );
    receipt.insert("asset_count".into(), json!(resolved_assets.reference_count));
    receipt.insert(
        "unique_asset_count".into(),
        json!(resolved_assets.assets.len()),
    );
    receipt.insert(
        "asset_set_sha256".into(),
        json!(resolved_assets.asset_set_sha256),
    );
    receipt.insert("assets".into(), json!(resolved_assets.assets));
    receipt.insert(
        "asset_export_revalidation".into(),
        json!("LENGTH_SHA256_AND_STATIC_PNG_STRUCTURE"),
    );
    receipt.insert("pptx_media_reopen".into(), json!("PASS"));
    if serde_json::to_vec(&execution.receipt)
        .map_err(|_| AgentError::IoFailed)?
        .len()
        > MAX_TOOL_RESULT_BYTES
    {
        return Err(AgentError::IoFailed);
    }
    Ok(execution)
}

fn resolve_png_snapshots(
    runtime: &ToolRuntime,
    resolved_assets: &ResolvedArtifactAssets,
) -> Result<Vec<ResolvedPngBytes>, AgentError> {
    resolved_assets
        .assets
        .iter()
        .map(|asset| {
            let bytes = runtime.read_asset_blob(
                &asset.blob_ref,
                asset.byte_length,
                &asset.content_sha256,
                crate::png_admission::MAX_PNG_BYTES,
            )?;
            let structure = crate::png_admission::validate_static_structure(&bytes)
                .map_err(|_| AgentError::AssetContentChanged)?;
            if structure.width != asset.width || structure.height != asset.height {
                return Err(AgentError::AssetContentChanged);
            }
            Ok(ResolvedPngBytes {
                fact: asset.clone(),
                bytes,
            })
        })
        .collect()
}

#[derive(Debug, Clone)]
struct ResolvedPngBytes {
    fact: ArtifactAssetFact,
    bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ExpectedDocumentMedia {
    content_sha256: String,
    width_emu: u64,
    height_emu: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ExpectedPresentationMedia {
    slide_index: usize,
    content_sha256: String,
    rect: SlideRect,
}

type DocumentImageReferences = (Vec<String>, Vec<(u64, u64)>);

fn expected_document_media(
    document: &DocumentArtifact,
    assets: &[ResolvedPngBytes],
) -> Result<Vec<ExpectedDocumentMedia>, AgentError> {
    let by_id = assets
        .iter()
        .map(|asset| (asset.fact.asset_id.0.as_str(), asset))
        .collect::<BTreeMap<_, _>>();
    document
        .blocks
        .iter()
        .filter_map(|block| match block {
            DocumentBlock::InlineImage { source, .. } => Some(source),
            _ => None,
        })
        .map(|source| {
            let asset = by_id
                .get(source.asset_id.0.as_str())
                .ok_or(AgentError::ArtifactReferenceNotFound)?;
            if asset.fact.content_sha256 != source.content_sha256
                || asset.fact.byte_length != source.byte_length
                || asset.fact.media_type != source.media_type
            {
                return Err(AgentError::ArtifactReferenceIntegrityFailed);
            }
            let (width_emu, height_emu) =
                document_image_extent(asset.fact.width, asset.fact.height)?;
            Ok(ExpectedDocumentMedia {
                content_sha256: asset.fact.content_sha256.clone(),
                width_emu,
                height_emu,
            })
        })
        .collect()
}

fn document_image_extent(width: u32, height: u32) -> Result<(u64, u64), AgentError> {
    let mut width_emu = u64::from(width)
        .checked_mul(9_525)
        .ok_or(AgentError::ArtifactContentInvalid)?;
    let mut height_emu = u64::from(height)
        .checked_mul(9_525)
        .ok_or(AgentError::ArtifactContentInvalid)?;
    if width_emu > DOCUMENT_MAX_IMAGE_WIDTH_EMU {
        height_emu = height_emu
            .checked_mul(DOCUMENT_MAX_IMAGE_WIDTH_EMU)
            .and_then(|value| value.checked_div(width_emu))
            .ok_or(AgentError::ArtifactContentInvalid)?;
        width_emu = DOCUMENT_MAX_IMAGE_WIDTH_EMU;
    }
    if height_emu > DOCUMENT_MAX_IMAGE_HEIGHT_EMU {
        width_emu = width_emu
            .checked_mul(DOCUMENT_MAX_IMAGE_HEIGHT_EMU)
            .and_then(|value| value.checked_div(height_emu))
            .ok_or(AgentError::ArtifactContentInvalid)?;
        height_emu = DOCUMENT_MAX_IMAGE_HEIGHT_EMU;
    }
    if width_emu == 0 || height_emu == 0 {
        return Err(AgentError::ArtifactContentInvalid);
    }
    Ok((width_emu, height_emu))
}

fn render_document_with_assets(
    document: &DocumentArtifact,
    assets: &[ResolvedPngBytes],
) -> Result<RenderedArtifact, AgentError> {
    let by_id = assets
        .iter()
        .map(|asset| (asset.fact.asset_id.0.as_str(), asset))
        .collect::<BTreeMap<_, _>>();
    let mut writer = DocxWriter::new();
    if let Some(title) = &document.title {
        writer.add_heading(title, 1);
    }
    for block in &document.blocks {
        match block {
            DocumentBlock::Heading { level, text } => {
                writer.add_heading(text, *level);
            }
            DocumentBlock::Paragraph { text } => {
                writer.add_paragraph(text);
            }
            DocumentBlock::BulletList { items } => {
                let items = items.iter().map(String::as_str).collect::<Vec<_>>();
                writer.add_list(&items, false);
            }
            DocumentBlock::Table { rows } => {
                let rows = rows
                    .iter()
                    .map(|row| row.iter().map(String::as_str).collect::<Vec<_>>())
                    .collect::<Vec<_>>();
                writer.add_table(&rows);
            }
            DocumentBlock::SpreadsheetRange { .. } => {
                return Err(AgentError::ArtifactContentInvalid);
            }
            DocumentBlock::InlineImage {
                source, alt_text, ..
            } => {
                let asset = by_id
                    .get(source.asset_id.0.as_str())
                    .ok_or(AgentError::ArtifactReferenceNotFound)?;
                let (width_emu, height_emu) =
                    document_image_extent(asset.fact.width, asset.fact.height)?;
                writer.add_ir_image(&Image {
                    alt_text: alt_text.clone(),
                    data: Some(asset.bytes.clone()),
                    format: Some(ImageFormat::Png),
                    display_width_emu: Some(width_emu),
                    display_height_emu: Some(height_emu),
                    pixel_width: Some(asset.fact.width),
                    pixel_height: Some(asset.fact.height),
                    decorative: alt_text.is_none(),
                    positioning: ImagePositioning::Inline,
                });
            }
        }
    }
    let mut output = Cursor::new(Vec::new());
    writer
        .write_to(&mut output)
        .map_err(|_| AgentError::IoFailed)?;
    Ok(RenderedArtifact {
        bytes: output.into_inner(),
    })
}

fn expected_presentation_media(
    plans: &[SlideLayoutPlan],
    assets: &[ResolvedPngBytes],
) -> Result<Vec<ExpectedPresentationMedia>, AgentError> {
    let by_id = assets
        .iter()
        .map(|asset| (asset.fact.asset_id.0.as_str(), asset))
        .collect::<BTreeMap<_, _>>();
    let mut expected = Vec::new();
    for (slide_index, plan) in plans.iter().enumerate() {
        for image in &plan.images {
            let asset = by_id
                .get(image.source.asset_id.0.as_str())
                .ok_or(AgentError::ArtifactReferenceNotFound)?;
            if asset.fact.content_sha256 != image.source.content_sha256
                || asset.fact.byte_length != image.source.byte_length
                || asset.fact.media_type != image.source.media_type
            {
                return Err(AgentError::ArtifactReferenceIntegrityFailed);
            }
            expected.push(ExpectedPresentationMedia {
                slide_index,
                content_sha256: asset.fact.content_sha256.clone(),
                rect: presentation_image_rect(
                    image.bounds,
                    asset.fact.width,
                    asset.fact.height,
                    image.fit,
                )?,
            });
        }
    }
    Ok(expected)
}

fn presentation_image_rect(
    bounds: SlideRect,
    pixel_width: u32,
    pixel_height: u32,
    fit: PresentationImageFitV1,
) -> Result<SlideRect, AgentError> {
    if bounds.width <= 0 || bounds.height <= 0 || pixel_width == 0 || pixel_height == 0 {
        return Err(AgentError::ArtifactContentInvalid);
    }
    let (width, height) = match fit {
        PresentationImageFitV1::Contain => {
            if i128::from(bounds.width) * i128::from(pixel_height)
                <= i128::from(bounds.height) * i128::from(pixel_width)
            {
                let height =
                    i128::from(bounds.width) * i128::from(pixel_height) / i128::from(pixel_width);
                (
                    bounds.width,
                    i64::try_from(height).map_err(|_| AgentError::ArtifactContentInvalid)?,
                )
            } else {
                let width =
                    i128::from(bounds.height) * i128::from(pixel_width) / i128::from(pixel_height);
                (
                    i64::try_from(width).map_err(|_| AgentError::ArtifactContentInvalid)?,
                    bounds.height,
                )
            }
        }
    };
    if width <= 0 || height <= 0 {
        return Err(AgentError::ArtifactContentInvalid);
    }
    let rect = SlideRect {
        x: bounds.x + (bounds.width - width) / 2,
        y: bounds.y + (bounds.height - height) / 2,
        width,
        height,
    };
    if !bounds.contains(rect) || !SlideMetrics::widescreen().slide.contains(rect) {
        return Err(AgentError::ArtifactContentInvalid);
    }
    Ok(rect)
}

fn render_presentation_with_assets(
    presentation: &PresentationArtifact,
    plans: &[SlideLayoutPlan],
    assets: &[ResolvedPngBytes],
) -> Result<RenderedArtifact, AgentError> {
    if presentation.slides.len() != plans.len() {
        return Err(AgentError::ArtifactContentInvalid);
    }
    let by_id = assets
        .iter()
        .map(|asset| (asset.fact.asset_id.0.as_str(), asset))
        .collect::<BTreeMap<_, _>>();
    let mut writer = PptxWriter::new();
    writer.set_presentation_size(
        PRESENTATION_WIDTH_EMU as u64,
        PRESENTATION_HEIGHT_EMU as u64,
    );
    for plan in plans {
        let slide = writer.add_slide();
        render_presentation_plan(slide, plan);
        for image in &plan.images {
            let asset = by_id
                .get(image.source.asset_id.0.as_str())
                .ok_or(AgentError::ArtifactReferenceNotFound)?;
            let rect = presentation_image_rect(
                image.bounds,
                asset.fact.width,
                asset.fact.height,
                image.fit,
            )?;
            slide.add_image(
                asset.bytes.clone(),
                ImageFormat::Png,
                rect.x,
                rect.y,
                u64::try_from(rect.width).map_err(|_| AgentError::ArtifactContentInvalid)?,
                u64::try_from(rect.height).map_err(|_| AgentError::ArtifactContentInvalid)?,
            );
        }
    }
    let mut output = Cursor::new(Vec::new());
    writer
        .write_to(&mut output)
        .map_err(|_| AgentError::IoFailed)?;
    Ok(RenderedArtifact {
        bytes: output.into_inner(),
    })
}

fn export_saved_spreadsheet(
    runtime: &ToolRuntime,
    artifact: &ArtifactReadView,
    output_path: &str,
    cancellation: &CommandCancellation,
) -> Result<ToolExecution, AgentError> {
    let guard = ExportGuard::new(cancellation);
    guard.check()?;
    validate_output_extension(output_path, "xlsx")?;
    let relative = normalize_relative(output_path)?;
    deny_sensitive(&relative)?;
    let target = resolve_for_write(&runtime.root, &relative)?;
    if target.exists() {
        return Err(AgentError::FileChanged);
    }
    let ArtifactContentV1::Spreadsheet(workbook_content) = &artifact.revision.content else {
        return Err(AgentError::ArtifactContentInvalid);
    };
    let mut canonical_workbook = workbook_content.clone();
    let semantic = spreadsheet::canonicalize(&mut canonical_workbook)?;
    let canonical_content = ArtifactContentV1::Spreadsheet(canonical_workbook.clone());
    let canonical_json = serde_json::to_string(&canonical_content)
        .map_err(|_| AgentError::ArtifactContentInvalid)?;
    if canonical_json.len() > MAX_DEFINITION_BYTES
        || sha256(canonical_json.as_bytes()) != artifact.revision.semantic_sha256
    {
        return Err(AgentError::ArtifactContentInvalid);
    }
    let rendered = spreadsheet::render(&canonical_workbook)?;
    guard.check()?;
    if rendered.bytes.is_empty() || rendered.bytes.len() > MAX_OUTPUT_BYTES {
        return Err(AgentError::FileTooLarge);
    }

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|_| AgentError::IoFailed)?;
    }
    let target = resolve_for_write(&runtime.root, &relative)?;
    if target.exists() {
        return Err(AgentError::FileChanged);
    }
    guard.check()?;
    atomic_write(&target, &rendered.bytes, true)?;
    let final_bytes = fs::read(&target).map_err(|_| AgentError::IoFailed)?;
    let final_check = if final_bytes.len() == rendered.bytes.len()
        && sha256(&final_bytes) == sha256(&rendered.bytes)
    {
        spreadsheet::reopen(&rendered, &final_bytes)
    } else {
        Err(AgentError::IoFailed)
    };
    if let Err(error) = final_check {
        let _ = fs::remove_file(&target);
        return Err(error);
    }

    let output_sha256 = sha256(&final_bytes);
    let facts = &rendered.facts;
    let receipt = json!({
        "kind":"ARTIFACT_EXPORTED",
        "artifact_id":artifact.artifact.artifact_id,
        "artifact_persistence":"DURABLE",
        "artifact_type":"SPREADSHEET",
        "artifact_revision_id":artifact.revision.revision_id,
        "exported_revision_id":artifact.revision.revision_id,
        "artifact_revision":artifact.revision.sequence,
        "artifact_semantic_sha256":artifact.revision.semantic_sha256,
        "content_schema_version":artifact.revision.content_schema_version,
        "semantic_unit_count":semantic.sheet_count + semantic.cell_count,
        "sheet_count":facts.sheet_count,
        "cell_count":facts.cell_count,
        "string_count":facts.string_count,
        "decimal_count":facts.decimal_count,
        "boolean_count":facts.boolean_count,
        "formula_count":facts.formula_count,
        "calculation_authority":spreadsheet::CALCULATION_AUTHORITY,
        "renderer_id":spreadsheet::RENDERER_ID,
        "renderer_version":spreadsheet::RENDERER_VERSION,
        "output_format":"XLSX",
        "path":relative_text(&relative),
        "output_bytes":final_bytes.len(),
        "output_sha256":output_sha256,
        "external_relationship_count":facts.external_relationship_count,
        "macro_part_count":facts.macro_part_count,
        "xlsx_static_security":"PASS",
        "structural_reopen":"STRUCTURAL_VALID",
        "roundtrip":"LITERAL_SEMANTIC_CONTENT_PRESENT",
    });
    let observation = serde_json::to_string(&json!({
        "artifact_id":artifact.artifact.artifact_id,
        "artifact_revision_id":artifact.revision.revision_id,
        "artifact_revision":artifact.revision.sequence,
        "artifact_persistence":"DURABLE",
        "artifact_type":"SPREADSHEET",
        "path":relative_text(&relative),
        "output_bytes":final_bytes.len(),
        "output_sha256":output_sha256,
        "structural_reopen":"STRUCTURAL_VALID",
        "roundtrip":"LITERAL_SEMANTIC_CONTENT_PRESENT",
        "visual_compatibility":"NOT_VERIFIED",
        "calculation_authority":spreadsheet::CALCULATION_AUTHORITY,
    }))
    .map_err(|_| AgentError::IoFailed)?;
    if serde_json::to_vec(&receipt)
        .map_err(|_| AgentError::IoFailed)?
        .len()
        > MAX_TOOL_RESULT_BYTES
        || observation.len() > MAX_TOOL_RESULT_BYTES
    {
        let _ = fs::remove_file(&target);
        return Err(AgentError::IoFailed);
    }
    Ok(ToolExecution {
        receipt,
        observation,
    })
}

fn export_saved_diagram(
    runtime: &ToolRuntime,
    artifact: &ArtifactReadView,
    output_path: &str,
    cancellation: &CommandCancellation,
) -> Result<ToolExecution, AgentError> {
    let guard = ExportGuard::new(cancellation);
    guard.check()?;
    validate_output_extension(output_path, "svg")?;
    let relative = normalize_relative(output_path)?;
    deny_sensitive(&relative)?;
    let target = resolve_for_write(&runtime.root, &relative)?;
    if target.exists() {
        return Err(AgentError::FileChanged);
    }
    let ArtifactContentV1::Diagram(diagram_content) = &artifact.revision.content else {
        return Err(AgentError::ArtifactContentInvalid);
    };
    let mut canonical_diagram = diagram_content.clone();
    let semantic = diagram::canonicalize(&mut canonical_diagram)?;
    let canonical_content = ArtifactContentV1::Diagram(canonical_diagram.clone());
    let canonical_json = serde_json::to_string(&canonical_content)
        .map_err(|_| AgentError::ArtifactContentInvalid)?;
    if canonical_json.len() > MAX_DEFINITION_BYTES
        || sha256(canonical_json.as_bytes()) != artifact.revision.semantic_sha256
    {
        return Err(AgentError::ArtifactContentInvalid);
    }
    let rendered = diagram::render(&canonical_diagram)?;
    guard.check()?;
    if rendered.bytes.is_empty() || rendered.bytes.len() > 2 * 1024 * 1024 {
        return Err(AgentError::FileTooLarge);
    }

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|_| AgentError::IoFailed)?;
    }
    let target = resolve_for_write(&runtime.root, &relative)?;
    if target.exists() {
        return Err(AgentError::FileChanged);
    }
    guard.check()?;
    atomic_write(&target, &rendered.bytes, true)?;
    let final_bytes = fs::read(&target).map_err(|_| AgentError::IoFailed)?;
    let final_check = if final_bytes.len() == rendered.bytes.len()
        && sha256(&final_bytes) == sha256(&rendered.bytes)
    {
        diagram::reopen(&rendered, &final_bytes)
    } else {
        Err(AgentError::IoFailed)
    };
    if let Err(error) = final_check {
        let _ = fs::remove_file(&target);
        return Err(error);
    }

    let output_sha256 = sha256(&final_bytes);
    let receipt = json!({
        "kind":"ARTIFACT_EXPORTED",
        "artifact_id":artifact.artifact.artifact_id,
        "artifact_persistence":"DURABLE",
        "artifact_type":"DIAGRAM",
        "artifact_revision_id":artifact.revision.revision_id,
        "exported_revision_id":artifact.revision.revision_id,
        "artifact_revision":artifact.revision.sequence,
        "artifact_semantic_sha256":artifact.revision.semantic_sha256,
        "content_schema_version":artifact.revision.content_schema_version,
        "semantic_unit_count":semantic.node_count + semantic.edge_count + semantic.group_count,
        "node_count":semantic.node_count,
        "edge_count":semantic.edge_count,
        "group_count":semantic.group_count,
        "layout_engine_id":diagram::LAYOUT_ENGINE_ID,
        "layout_sha256":rendered.facts.layout_sha256,
        "renderer_id":diagram::RENDERER_ID,
        "renderer_version":diagram::RENDERER_VERSION,
        "theme_profile":diagram::THEME_PROFILE,
        "output_format":"SVG",
        "view_box_width":rendered.facts.view_box_width,
        "view_box_height":rendered.facts.view_box_height,
        "path":relative_text(&relative),
        "output_bytes":final_bytes.len(),
        "output_sha256":output_sha256,
        "static_svg_security":"PASS",
        "structural_reopen":"STRUCTURAL_VALID",
        "roundtrip":"SEMANTIC_CONTENT_PRESENT",
    });
    let observation = serde_json::to_string(&json!({
        "artifact_id":artifact.artifact.artifact_id,
        "artifact_revision_id":artifact.revision.revision_id,
        "artifact_revision":artifact.revision.sequence,
        "artifact_persistence":"DURABLE",
        "artifact_type":"DIAGRAM",
        "path":relative_text(&relative),
        "output_bytes":final_bytes.len(),
        "output_sha256":output_sha256,
        "structural_reopen":"STRUCTURAL_VALID",
        "roundtrip":"SEMANTIC_CONTENT_PRESENT",
        "visual_compatibility":"NOT_VERIFIED",
    }))
    .map_err(|_| AgentError::IoFailed)?;
    if serde_json::to_vec(&receipt)
        .map_err(|_| AgentError::IoFailed)?
        .len()
        > MAX_TOOL_RESULT_BYTES
        || observation.len() > MAX_TOOL_RESULT_BYTES
    {
        let _ = fs::remove_file(&target);
        return Err(AgentError::IoFailed);
    }
    Ok(ToolExecution {
        receipt,
        observation,
    })
}

pub(super) fn export(
    runtime: &ToolRuntime,
    arguments: &Value,
    cancellation: &CommandCancellation,
) -> Result<ToolExecution, AgentError> {
    export_with(runtime, arguments, cancellation, render, |_, _| {})
}

fn export_with<R, H>(
    runtime: &ToolRuntime,
    arguments: &Value,
    cancellation: &CommandCancellation,
    renderer: R,
    hook: H,
) -> Result<ToolExecution, AgentError>
where
    R: FnOnce(&ArtifactDefinition) -> Result<RenderedArtifact, AgentError>,
    H: Fn(ExportStage, &Path),
{
    export_with_validation(
        runtime,
        arguments,
        cancellation,
        renderer,
        validate_rendered,
        hook,
    )
}

fn export_with_validation<R, V, H>(
    runtime: &ToolRuntime,
    arguments: &Value,
    cancellation: &CommandCancellation,
    renderer: R,
    validator: V,
    hook: H,
) -> Result<ToolExecution, AgentError>
where
    R: FnOnce(&ArtifactDefinition) -> Result<RenderedArtifact, AgentError>,
    V: Fn(&ArtifactDefinition, &[u8]) -> Result<(), AgentError>,
    H: Fn(ExportStage, &Path),
{
    let guard = ExportGuard::new(cancellation);
    guard.check()?;
    let encoded_arguments =
        serde_json::to_vec(arguments).map_err(|_| AgentError::ToolArgumentsInvalid)?;
    if encoded_arguments.len() > MAX_DEFINITION_BYTES {
        return Err(AgentError::ToolArgumentsInvalid);
    }
    let args: ExportArgs =
        serde_json::from_value(arguments.clone()).map_err(|_| AgentError::ToolArgumentsInvalid)?;
    validate_output_path(&args)?;
    let relative = normalize_relative(&args.output_path)?;
    deny_sensitive(&relative)?;
    let target = resolve_for_write(&runtime.root, &relative)?;
    if target.exists() {
        return Err(AgentError::FileChanged);
    }
    let definition = parse_definition(args.artifact_type, args.content)?;
    validate_definition(&definition)?;
    let definition_bytes = serde_json::to_vec(&json!({
        "schema_version": ARTIFACT_SCHEMA_VERSION,
        "artifact": definition,
    }))
    .map_err(|_| AgentError::ToolArgumentsInvalid)?;
    if definition_bytes.len() > MAX_DEFINITION_BYTES {
        return Err(AgentError::ToolArgumentsInvalid);
    }
    let definition_sha256 = sha256(&definition_bytes);
    hook(ExportStage::Validated, &target);
    guard.check()?;

    let rendered = renderer(&definition)?;
    hook(ExportStage::Rendered, &target);
    guard.check()?;
    if rendered.bytes.is_empty() || rendered.bytes.len() > MAX_OUTPUT_BYTES {
        return Err(AgentError::FileTooLarge);
    }
    validator(&definition, &rendered.bytes)?;
    guard.check()?;

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|_| AgentError::IoFailed)?;
    }
    let target = resolve_for_write(&runtime.root, &relative)?;
    if target.exists() {
        return Err(AgentError::FileChanged);
    }
    hook(ExportStage::BeforeAtomicWrite, &target);
    guard.check()?;
    atomic_write(&target, &rendered.bytes, true)?;

    let final_bytes = fs::read(&target).map_err(|_| AgentError::IoFailed)?;
    let final_check = if final_bytes.len() == rendered.bytes.len()
        && sha256(&final_bytes) == sha256(&rendered.bytes)
    {
        validator(&definition, &final_bytes)
    } else {
        Err(AgentError::IoFailed)
    };
    if let Err(error) = final_check {
        let _ = fs::remove_file(&target);
        return Err(error);
    }

    let artifact_type = definition.artifact_type();
    let output_sha256 = sha256(&final_bytes);
    let artifact_id = Uuid::now_v7().to_string();
    let semantic_count = definition.semantic_count();
    let receipt = json!({
        "kind":"ARTIFACT_EXPORTED",
        "artifact_id":artifact_id,
        "artifact_persistence":"REQUEST_SCOPED",
        "artifact_type":artifact_type.id(),
        "artifact_revision":ARTIFACT_REVISION,
        "artifact_definition_sha256":definition_sha256,
        "semantic_unit_count":semantic_count,
        "renderer_id":artifact_type.renderer_id(),
        "renderer_version":artifact_type.renderer_version(),
        "output_format":artifact_type.extension().to_ascii_uppercase(),
        "path":relative_text(&relative),
        "output_bytes":final_bytes.len(),
        "output_sha256":output_sha256,
        "structural_reopen":"STRUCTURAL_VALID",
        "roundtrip":"SEMANTIC_CONTENT_PRESENT",
    });
    let observation = serde_json::to_string(&json!({
        "artifact_id":artifact_id,
        "artifact_persistence":"REQUEST_SCOPED",
        "artifact_type":artifact_type.id(),
        "artifact_revision":ARTIFACT_REVISION,
        "path":relative_text(&relative),
        "output_bytes":final_bytes.len(),
        "output_sha256":output_sha256,
        "structural_reopen":"STRUCTURAL_VALID",
        "roundtrip":"SEMANTIC_CONTENT_PRESENT",
        "visual_compatibility":"NOT_VERIFIED",
    }))
    .map_err(|_| AgentError::IoFailed)?;
    if serde_json::to_vec(&receipt)
        .map_err(|_| AgentError::IoFailed)?
        .len()
        > MAX_TOOL_RESULT_BYTES
        || observation.len() > MAX_TOOL_RESULT_BYTES
    {
        let _ = fs::remove_file(&target);
        return Err(AgentError::IoFailed);
    }
    Ok(ToolExecution {
        receipt,
        observation,
    })
}

fn parse_definition(
    artifact_type: ArtifactType,
    content: Value,
) -> Result<ArtifactDefinition, AgentError> {
    match artifact_type {
        ArtifactType::Document => serde_json::from_value(content)
            .map(ArtifactDefinition::Document)
            .map_err(|_| AgentError::ToolArgumentsInvalid),
        ArtifactType::Presentation => serde_json::from_value(content)
            .map(ArtifactDefinition::Presentation)
            .map_err(|_| AgentError::ToolArgumentsInvalid),
    }
}

fn validate_output_path(args: &ExportArgs) -> Result<(), AgentError> {
    validate_output_extension(&args.output_path, args.artifact_type.extension())
}

fn validate_output_extension(output_path: &str, extension: &str) -> Result<(), AgentError> {
    if output_path.len() > 4_096
        || output_path.contains("://")
        || Path::new(output_path)
            .extension()
            .and_then(|value| value.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref()
            != Some(extension)
    {
        return Err(AgentError::ToolArgumentsInvalid);
    }
    Ok(())
}

fn validate_definition(definition: &ArtifactDefinition) -> Result<(), AgentError> {
    let mut text_bytes = 0usize;
    let mut lists = 0usize;
    let mut list_items = 0usize;
    match definition {
        ArtifactDefinition::Document(document) => {
            if document.blocks.is_empty() || document.blocks.len() > MAX_DOCUMENT_BLOCKS {
                return Err(AgentError::ToolArgumentsInvalid);
            }
            if let Some(title) = &document.title {
                admit_text(title, &mut text_bytes)?;
            }
            let mut tables = 0usize;
            let mut cells = 0usize;
            for block in &document.blocks {
                match block {
                    DocumentBlock::Heading { level, text } => {
                        if !(1..=3).contains(level) {
                            return Err(AgentError::ToolArgumentsInvalid);
                        }
                        admit_text(text, &mut text_bytes)?;
                    }
                    DocumentBlock::Paragraph { text } => admit_text(text, &mut text_bytes)?,
                    DocumentBlock::BulletList { items } => {
                        admit_list(items, &mut lists, &mut list_items, &mut text_bytes)?;
                    }
                    DocumentBlock::Table { rows } => {
                        tables += 1;
                        if tables > MAX_TABLES || rows.is_empty() || rows.len() > MAX_TABLE_ROWS {
                            return Err(AgentError::ToolArgumentsInvalid);
                        }
                        let columns = rows.first().map_or(0, Vec::len);
                        if columns == 0
                            || columns > MAX_TABLE_COLUMNS
                            || rows.iter().any(|row| row.len() != columns)
                        {
                            return Err(AgentError::ToolArgumentsInvalid);
                        }
                        cells = cells
                            .checked_add(rows.len() * columns)
                            .ok_or(AgentError::ToolArgumentsInvalid)?;
                        if cells > MAX_TABLE_CELLS {
                            return Err(AgentError::ToolArgumentsInvalid);
                        }
                        for cell in rows.iter().flatten() {
                            admit_text_allow_empty(cell, &mut text_bytes)?;
                        }
                    }
                    DocumentBlock::SpreadsheetRange { source } => {
                        tables += 1;
                        let reference = &source.artifact_ref;
                        if reference.artifact_id.0.is_empty()
                            || reference.artifact_id.0.len() > 128
                            || reference.revision_id.0.is_empty()
                            || reference.revision_id.0.len() > 128
                            || reference.semantic_sha256.len() != 64
                            || !reference
                                .semantic_sha256
                                .bytes()
                                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
                            || tables > MAX_TABLES
                        {
                            return Err(AgentError::ToolArgumentsInvalid);
                        }
                        if admit_spreadsheet_range(source).is_ok() {
                            let rows = usize::try_from(source.end_row - source.start_row + 1)
                                .map_err(|_| AgentError::ToolArgumentsInvalid)?;
                            let columns = usize::from(source.end_column - source.start_column + 1);
                            cells = cells
                                .checked_add(rows * columns)
                                .ok_or(AgentError::ToolArgumentsInvalid)?;
                            if cells > MAX_TABLE_CELLS {
                                return Err(AgentError::ToolArgumentsInvalid);
                            }
                        }
                    }
                    DocumentBlock::InlineImage {
                        source, alt_text, ..
                    } => {
                        if source.asset_id.0.is_empty()
                            || source.asset_id.0.len() > 128
                            || source.media_type != AssetMediaType::Png
                            || source.byte_length == 0
                            || source.byte_length > 8 * 1024 * 1024
                            || source.content_sha256.len() != 64
                            || !source
                                .content_sha256
                                .bytes()
                                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
                        {
                            return Err(AgentError::ToolArgumentsInvalid);
                        }
                        if let Some(alt_text) = alt_text {
                            if alt_text.trim().is_empty() || alt_text.len() > MAX_ALT_TEXT_BYTES {
                                return Err(AgentError::ToolArgumentsInvalid);
                            }
                            admit_text(alt_text, &mut text_bytes)?;
                        }
                    }
                }
            }
        }
        ArtifactDefinition::Presentation(presentation) => {
            if presentation.slides.is_empty() || presentation.slides.len() > MAX_SLIDES {
                return Err(AgentError::ToolArgumentsInvalid);
            }
            for slide in &presentation.slides {
                let before_slide = text_bytes;
                admit_text(&slide.title, &mut text_bytes)?;
                if slide.regions.len() > MAX_REGIONS_PER_SLIDE {
                    return Err(AgentError::ToolArgumentsInvalid);
                }
                let slots = slide
                    .regions
                    .iter()
                    .map(|region| region.slot)
                    .collect::<HashSet<_>>();
                if slots.len() != slide.regions.len()
                    || match slide.layout {
                        PresentationLayout::Title => !slide.regions.is_empty(),
                        PresentationLayout::TitleAndBody => {
                            slots != HashSet::from([SlideSlot::Body])
                        }
                        PresentationLayout::TwoColumn => {
                            slots != HashSet::from([SlideSlot::Left, SlideSlot::Right])
                        }
                    }
                {
                    return Err(AgentError::ToolArgumentsInvalid);
                }
                let mut elements = 0usize;
                for region in &slide.regions {
                    if region.blocks.is_empty() || region.blocks.len() > MAX_BLOCKS_PER_REGION {
                        return Err(AgentError::ToolArgumentsInvalid);
                    }
                    elements += region.blocks.len();
                    if elements > MAX_ELEMENTS_PER_SLIDE {
                        return Err(AgentError::ToolArgumentsInvalid);
                    }
                    for block in &region.blocks {
                        match block {
                            PresentationBlock::Paragraph { text } => {
                                admit_text(text, &mut text_bytes)?;
                            }
                            PresentationBlock::BulletList { items } => {
                                admit_list(items, &mut lists, &mut list_items, &mut text_bytes)?;
                            }
                            PresentationBlock::Image { source, .. } => {
                                if region.blocks.len() != 1 {
                                    return Err(AgentError::ToolArgumentsInvalid);
                                }
                                validate_asset_ref(source)
                                    .map_err(|_| AgentError::ToolArgumentsInvalid)?;
                            }
                        }
                    }
                }
                if text_bytes - before_slide > MAX_SLIDE_TEXT_BYTES {
                    return Err(AgentError::ToolArgumentsInvalid);
                }
            }
        }
    }
    if text_bytes > MAX_TOTAL_TEXT_BYTES {
        return Err(AgentError::ToolArgumentsInvalid);
    }
    Ok(())
}

fn admit_text(text: &str, total: &mut usize) -> Result<(), AgentError> {
    if text.trim().is_empty() || text.contains('\0') {
        return Err(AgentError::ToolArgumentsInvalid);
    }
    admit_text_allow_empty(text, total)
}

fn admit_text_allow_empty(text: &str, total: &mut usize) -> Result<(), AgentError> {
    if text.contains('\0') || text.len() > MAX_TEXT_ITEM_BYTES {
        return Err(AgentError::ToolArgumentsInvalid);
    }
    *total = total
        .checked_add(text.len())
        .ok_or(AgentError::ToolArgumentsInvalid)?;
    if *total > MAX_TOTAL_TEXT_BYTES {
        return Err(AgentError::ToolArgumentsInvalid);
    }
    Ok(())
}

fn admit_list(
    items: &[String],
    lists: &mut usize,
    total_items: &mut usize,
    text_bytes: &mut usize,
) -> Result<(), AgentError> {
    *lists += 1;
    *total_items = total_items
        .checked_add(items.len())
        .ok_or(AgentError::ToolArgumentsInvalid)?;
    if *lists > MAX_LISTS
        || items.is_empty()
        || items.len() > MAX_LIST_ITEMS_PER_LIST
        || *total_items > MAX_TOTAL_LIST_ITEMS
    {
        return Err(AgentError::ToolArgumentsInvalid);
    }
    for item in items {
        admit_text(item, text_bytes)?;
    }
    Ok(())
}

fn render(definition: &ArtifactDefinition) -> Result<RenderedArtifact, AgentError> {
    let mut output = Cursor::new(Vec::new());
    match definition {
        ArtifactDefinition::Document(document) => {
            let mut writer = DocxWriter::new();
            if let Some(title) = &document.title {
                writer.add_heading(title, 1);
            }
            for block in &document.blocks {
                match block {
                    DocumentBlock::Heading { level, text } => {
                        writer.add_heading(text, *level);
                    }
                    DocumentBlock::Paragraph { text } => {
                        writer.add_paragraph(text);
                    }
                    DocumentBlock::BulletList { items } => {
                        let items = items.iter().map(String::as_str).collect::<Vec<_>>();
                        writer.add_list(&items, false);
                    }
                    DocumentBlock::Table { rows } => {
                        let rows = rows
                            .iter()
                            .map(|row| row.iter().map(String::as_str).collect::<Vec<_>>())
                            .collect::<Vec<_>>();
                        writer.add_table(&rows);
                    }
                    DocumentBlock::SpreadsheetRange { .. } => {
                        return Err(AgentError::ArtifactContentInvalid);
                    }
                    DocumentBlock::InlineImage { .. } => {
                        return Err(AgentError::ArtifactContentInvalid);
                    }
                }
            }
            writer
                .write_to(&mut output)
                .map_err(|_| AgentError::IoFailed)?;
        }
        ArtifactDefinition::Presentation(presentation) => {
            let plans = plan_presentation(presentation)?;
            if plans.iter().any(|plan| !plan.images.is_empty()) {
                // Durable Asset refs require the saved-revision resolver and
                // cannot be rendered by request-scoped legacy export.
                return Err(AgentError::ArtifactContentInvalid);
            }
            let mut writer = PptxWriter::new();
            writer.set_presentation_size(
                PRESENTATION_WIDTH_EMU as u64,
                PRESENTATION_HEIGHT_EMU as u64,
            );
            for plan in &plans {
                let slide = writer.add_slide();
                render_presentation_plan(slide, plan);
            }
            writer
                .write_to(&mut output)
                .map_err(|_| AgentError::IoFailed)?;
        }
    }
    Ok(RenderedArtifact {
        bytes: output.into_inner(),
    })
}

fn plan_presentation(
    presentation: &PresentationArtifact,
) -> Result<Vec<SlideLayoutPlan>, AgentError> {
    let metrics = SlideMetrics::widescreen();
    if !metrics.slide.contains(metrics.cover_title)
        || !metrics.slide.contains(metrics.cover_subtitle)
        || !metrics.slide.contains(metrics.title)
        || !metrics.slide.contains(metrics.body)
        || !metrics.body.contains(metrics.left)
        || !metrics.body.contains(metrics.right)
        || metrics.title.overlaps(metrics.body)
        || metrics.left.overlaps(metrics.right)
        || metrics.right.x - metrics.left.right() != metrics.column_gap
        || metrics.body.x != metrics.margin_left
        || metrics.slide.right() - metrics.body.right() != metrics.margin_right
        || metrics.title.y != metrics.margin_top
        || metrics.slide.bottom() - metrics.body.bottom() != metrics.margin_bottom
        || metrics.left.x - metrics.body.x != metrics.column_padding
        || metrics.body.right() - metrics.right.right() != metrics.column_padding
    {
        return Err(AgentError::IoFailed);
    }
    presentation
        .slides
        .iter()
        .map(|slide| plan_slide(slide, metrics))
        .collect()
}

fn plan_slide(
    slide: &PresentationSlide,
    metrics: SlideMetrics,
) -> Result<SlideLayoutPlan, AgentError> {
    match slide.layout {
        PresentationLayout::Title => plan_cover_slide(slide, metrics),
        PresentationLayout::TitleAndBody => {
            let region = slide
                .regions
                .iter()
                .find(|region| region.slot == SlideSlot::Body)
                .ok_or(AgentError::ToolArgumentsInvalid)?;
            let density = region_density(region, metrics.body, false);
            let mut lines = fit_text_box(
                &slide.title,
                metrics.title,
                &[28, 27, 26],
                2,
                PresentationTextRole::SlideTitle,
                true,
                PRIMARY_TEXT_COLOR,
            )?;
            for font_size_pt in body_font_candidates(density) {
                if let Some(mut body) = plan_region(region, metrics.body, *font_size_pt, false) {
                    lines.append(&mut body);
                    return Ok(SlideLayoutPlan {
                        layout: slide.layout,
                        density,
                        lines,
                        images: planned_region_image(region, metrics.body)
                            .into_iter()
                            .collect(),
                    });
                }
            }
            Err(AgentError::PresentationContentOverflow)
        }
        PresentationLayout::TwoColumn => {
            let left = slide
                .regions
                .iter()
                .find(|region| region.slot == SlideSlot::Left)
                .ok_or(AgentError::ToolArgumentsInvalid)?;
            let right = slide
                .regions
                .iter()
                .find(|region| region.slot == SlideSlot::Right)
                .ok_or(AgentError::ToolArgumentsInvalid)?;
            let density = region_density(left, metrics.left, true).max(region_density(
                right,
                metrics.right,
                true,
            ));
            let title = fit_text_box(
                &slide.title,
                metrics.title,
                &[28, 27, 26],
                2,
                PresentationTextRole::SlideTitle,
                true,
                PRIMARY_TEXT_COLOR,
            )?;
            for font_size_pt in body_font_candidates(density) {
                let Some(mut left_lines) = plan_region(left, metrics.left, *font_size_pt, true)
                else {
                    continue;
                };
                let Some(mut right_lines) = plan_region(right, metrics.right, *font_size_pt, true)
                else {
                    continue;
                };
                let mut lines = title.clone();
                lines.append(&mut left_lines);
                lines.append(&mut right_lines);
                return Ok(SlideLayoutPlan {
                    layout: slide.layout,
                    density,
                    lines,
                    images: planned_region_image(left, metrics.left)
                        .into_iter()
                        .chain(planned_region_image(right, metrics.right))
                        .collect(),
                });
            }
            Err(AgentError::PresentationContentOverflow)
        }
    }
}

fn plan_cover_slide(
    slide: &PresentationSlide,
    metrics: SlideMetrics,
) -> Result<SlideLayoutPlan, AgentError> {
    let mut explicit_lines = slide
        .title
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty());
    let title = explicit_lines
        .next()
        .ok_or(AgentError::ToolArgumentsInvalid)?;
    let subtitle = explicit_lines.collect::<Vec<_>>().join("\n");
    let mut lines = fit_text_box(
        title,
        metrics.cover_title,
        &[40, 38, 36, 34],
        2,
        PresentationTextRole::CoverTitle,
        true,
        PRIMARY_TEXT_COLOR,
    )?;
    if !subtitle.is_empty() {
        lines.append(&mut fit_text_box(
            &subtitle,
            metrics.cover_subtitle,
            &[22, 20, 18, 17],
            3,
            PresentationTextRole::CoverSubtitle,
            false,
            SECONDARY_TEXT_COLOR,
        )?);
    }
    Ok(SlideLayoutPlan {
        layout: slide.layout,
        density: ContentDensity::Low,
        lines,
        images: Vec::new(),
    })
}

fn planned_region_image(
    region: &SlideRegion,
    bounds: SlideRect,
) -> Option<PlannedPresentationImage> {
    match region.blocks.as_slice() {
        [PresentationBlock::Image { source, fit }] => Some(PlannedPresentationImage {
            source: source.clone(),
            fit: *fit,
            bounds,
        }),
        _ => None,
    }
}

fn body_font_candidates(density: ContentDensity) -> &'static [u16] {
    match density {
        ContentDensity::Low => &[20, 18, 16, 15],
        ContentDensity::Normal => &[18, 16, 15],
        ContentDensity::High => &[16, 15],
    }
}

fn region_density(region: &SlideRegion, bounds: SlideRect, column: bool) -> ContentDensity {
    let bullet_indent = if column { 285_750 } else { 323_850 };
    let mut lines = 0usize;
    for (index, block) in region.blocks.iter().enumerate() {
        match block {
            PresentationBlock::Paragraph { text } => {
                let size = if column && index == 0 { 22 } else { 20 };
                lines += wrap_text(text, bounds.width, size).len();
            }
            PresentationBlock::BulletList { items } => {
                lines += items
                    .iter()
                    .map(|item| wrap_text(item, bounds.width - bullet_indent, 20).len())
                    .sum::<usize>();
            }
            PresentationBlock::Image { .. } => {}
        }
    }
    if lines <= 6 {
        ContentDensity::Low
    } else if lines <= 11 {
        ContentDensity::Normal
    } else {
        ContentDensity::High
    }
}

fn plan_region(
    region: &SlideRegion,
    bounds: SlideRect,
    font_size_pt: u16,
    column: bool,
) -> Option<Vec<PlannedTextLine>> {
    let mut planned = Vec::new();
    let mut y = bounds.y;
    let bullet_indent = if column { 285_750 } else { 323_850 };
    let marker_width = 177_800;
    for (block_index, block) in region.blocks.iter().enumerate() {
        match block {
            PresentationBlock::Paragraph { text } => {
                let is_column_heading = column && block_index == 0;
                let paragraph_size = if is_column_heading {
                    (font_size_pt + 2).min(22)
                } else {
                    font_size_pt
                };
                let role = if is_column_heading {
                    PresentationTextRole::ColumnHeading
                } else {
                    PresentationTextRole::Body
                };
                let style = PresentationTextStyle {
                    role,
                    font_size_pt: paragraph_size,
                    bold: is_column_heading,
                    color: if is_column_heading {
                        ACCENT_TEXT_COLOR
                    } else {
                        PRIMARY_TEXT_COLOR
                    },
                };
                let wrapped = wrap_text(text, bounds.width, paragraph_size);
                let line_height = line_height_emu(paragraph_size);
                for text in wrapped {
                    let rect = SlideRect {
                        x: bounds.x,
                        y,
                        width: bounds.width,
                        height: line_height,
                    };
                    if !bounds.contains(rect) {
                        return None;
                    }
                    planned.push(PlannedTextLine { text, rect, style });
                    y += line_height;
                }
                y += if is_column_heading {
                    points_to_emu((font_size_pt as f64) * 0.65)
                } else {
                    points_to_emu((font_size_pt as f64) * 0.8)
                };
            }
            PresentationBlock::BulletList { items } => {
                let bullet_font_size_pt = font_size_pt.saturating_sub(1).max(15);
                let marker_style = PresentationTextStyle {
                    role: PresentationTextRole::BulletMarker,
                    font_size_pt: bullet_font_size_pt,
                    bold: false,
                    color: ACCENT_TEXT_COLOR,
                };
                let bullet_style = PresentationTextStyle {
                    role: PresentationTextRole::Bullet,
                    font_size_pt: bullet_font_size_pt,
                    bold: false,
                    color: PRIMARY_TEXT_COLOR,
                };
                for item in items {
                    let wrapped =
                        wrap_text(item, bounds.width - bullet_indent, bullet_font_size_pt);
                    let line_height = line_height_emu(bullet_font_size_pt);
                    let marker_rect = SlideRect {
                        x: bounds.x,
                        y,
                        width: marker_width,
                        height: line_height,
                    };
                    if !bounds.contains(marker_rect) {
                        return None;
                    }
                    planned.push(PlannedTextLine {
                        text: "•".into(),
                        rect: marker_rect,
                        style: marker_style,
                    });
                    for text in wrapped {
                        let rect = SlideRect {
                            x: bounds.x + bullet_indent,
                            y,
                            width: bounds.width - bullet_indent,
                            height: line_height,
                        };
                        if !bounds.contains(rect) {
                            return None;
                        }
                        planned.push(PlannedTextLine {
                            text,
                            rect,
                            style: bullet_style,
                        });
                        y += line_height;
                    }
                    y += points_to_emu((bullet_font_size_pt as f64) * 0.38);
                }
                y += points_to_emu((bullet_font_size_pt as f64) * 0.35);
            }
            PresentationBlock::Image { .. } => {}
        }
    }
    Some(planned)
}

fn fit_text_box(
    text: &str,
    bounds: SlideRect,
    font_sizes: &[u16],
    max_lines: usize,
    role: PresentationTextRole,
    bold: bool,
    color: &'static str,
) -> Result<Vec<PlannedTextLine>, AgentError> {
    for font_size_pt in font_sizes {
        let wrapped = wrap_text(text, bounds.width, *font_size_pt);
        let line_height = line_height_emu(*font_size_pt);
        if wrapped.is_empty()
            || wrapped.len() > max_lines
            || line_height * wrapped.len() as i64 > bounds.height
        {
            continue;
        }
        let style = PresentationTextStyle {
            role,
            font_size_pt: *font_size_pt,
            bold,
            color,
        };
        return Ok(wrapped
            .into_iter()
            .enumerate()
            .map(|(index, text)| PlannedTextLine {
                text,
                rect: SlideRect {
                    x: bounds.x,
                    y: bounds.y + line_height * index as i64,
                    width: bounds.width,
                    height: line_height,
                },
                style,
            })
            .collect());
    }
    Err(AgentError::PresentationContentOverflow)
}

fn wrap_text(text: &str, width_emu: i64, font_size_pt: u16) -> Vec<String> {
    let mut output = Vec::new();
    for explicit_line in text.lines() {
        let characters = explicit_line.trim().chars().collect::<Vec<_>>();
        if characters.is_empty() {
            continue;
        }
        let mut start = 0usize;
        while start < characters.len() {
            let mut end = start;
            let mut measured = 0f64;
            let mut last_break = None;
            while end < characters.len() {
                let next = glyph_width_emu(characters[end], font_size_pt);
                if measured + next > width_emu as f64 {
                    break;
                }
                measured += next;
                if is_break_opportunity(characters[end]) {
                    last_break = Some(end + 1);
                }
                end += 1;
            }
            if end == start {
                end += 1;
            } else if end < characters.len()
                && let Some(preferred) = last_break
                && preferred > start
            {
                end = preferred;
            }
            let line = characters[start..end]
                .iter()
                .collect::<String>()
                .trim()
                .to_owned();
            if !line.is_empty() {
                output.push(line);
            }
            start = end;
            while start < characters.len() && characters[start].is_whitespace() {
                start += 1;
            }
        }
    }
    output
}

fn glyph_width_emu(character: char, font_size_pt: u16) -> f64 {
    let factor = if is_cjk(character) {
        1.0
    } else if character.is_whitespace() {
        0.32
    } else if character.is_ascii_uppercase() {
        0.64
    } else if character.is_ascii_lowercase() {
        0.54
    } else if character.is_ascii_digit() {
        0.56
    } else {
        0.42
    };
    font_size_pt as f64 * factor * EMU_PER_POINT
}

fn is_break_opportunity(character: char) -> bool {
    character.is_whitespace()
        || matches!(
            character,
            '-' | '/' | '—' | '，' | '。' | '、' | '；' | '：' | ',' | '.' | ';' | ':'
        )
}

fn is_cjk(character: char) -> bool {
    matches!(
        character as u32,
        0x3000..=0x30ff | 0x3400..=0x9fff | 0xac00..=0xd7af | 0xf900..=0xfaff | 0xff00..=0xffef
    )
}

fn points_to_emu(points: f64) -> i64 {
    (points * EMU_PER_POINT).ceil() as i64
}

fn line_height_emu(font_size_pt: u16) -> i64 {
    points_to_emu(font_size_pt as f64 * 1.28)
}

fn styled_runs(line: &PlannedTextLine) -> Vec<Run> {
    let mut groups = Vec::<(bool, String)>::new();
    for character in line.text.chars() {
        let cjk = is_cjk(character);
        if let Some((last_cjk, text)) = groups.last_mut()
            && *last_cjk == cjk
        {
            text.push(character);
        } else {
            groups.push((cjk, character.to_string()));
        }
    }
    groups
        .into_iter()
        .map(|(cjk, text)| {
            let mut run = Run::new(text)
                .font(if cjk { CJK_FONT } else { LATIN_FONT })
                .font_size(line.style.font_size_pt as f64)
                .color(line.style.color);
            if line.style.bold {
                run = run.bold();
            }
            run
        })
        .collect()
}

fn render_presentation_plan(slide: &mut SlideData, plan: &SlideLayoutPlan) {
    for line in &plan.lines {
        slide.add_rich_text_box(
            &styled_runs(line),
            line.rect.x,
            line.rect.y,
            line.rect.width,
            line.rect.height,
        );
    }
}

fn validate_rendered(definition: &ArtifactDefinition, bytes: &[u8]) -> Result<(), AgentError> {
    if !bytes.starts_with(b"PK\x03\x04") {
        return Err(AgentError::IoFailed);
    }
    let artifact_type = definition.artifact_type();
    let required = match artifact_type {
        ArtifactType::Document => vec!["[Content_Types].xml", "_rels/.rels", "word/document.xml"],
        ArtifactType::Presentation => vec![
            "[Content_Types].xml",
            "_rels/.rels",
            "ppt/presentation.xml",
            "ppt/slides/slide1.xml",
        ],
    };
    let mut archive = ZipArchive::new(Cursor::new(bytes)).map_err(|_| AgentError::IoFailed)?;
    for name in required {
        archive.by_name(name).map_err(|_| AgentError::IoFailed)?;
    }
    let document_xml = if artifact_type == ArtifactType::Document {
        let mut xml = String::new();
        archive
            .by_name("word/document.xml")
            .map_err(|_| AgentError::IoFailed)?
            .read_to_string(&mut xml)
            .map_err(|_| AgentError::IoFailed)?;
        Some(xml)
    } else {
        None
    };
    drop(archive);
    let reopened = Document::from_reader(Cursor::new(bytes.to_vec()), artifact_type.format())
        .map_err(|_| AgentError::IoFailed)?;
    if reopened.format() != artifact_type.format() {
        return Err(AgentError::IoFailed);
    }
    let plain_text = reopened.plain_text();
    let missing_semantic_text = match artifact_type {
        ArtifactType::Document => definition.expected_text().iter().any(|expected| {
            !plain_text.contains(expected)
                && !document_xml
                    .as_deref()
                    .is_some_and(|xml| xml.contains(&escape_xml_text(expected)))
        }),
        ArtifactType::Presentation => {
            let compact_plain_text = compact_whitespace(&plain_text);
            definition
                .expected_text()
                .iter()
                .any(|expected| !compact_plain_text.contains(&compact_whitespace(expected)))
        }
    };
    if missing_semantic_text {
        return Err(AgentError::IoFailed);
    }
    if let ArtifactDefinition::Presentation(presentation) = definition
        && reopened.to_ir().sections.len() != presentation.slides.len()
    {
        return Err(AgentError::IoFailed);
    }
    Ok(())
}

/// Independent production reopen for the exact DOCX PNG media graph. This is
/// intentionally narrower than the broader office-writer probe: it validates
/// only facts that form the durable Asset export boundary.
fn validate_docx_png_media(
    bytes: &[u8],
    expected: &[ExpectedDocumentMedia],
) -> Result<(), AgentError> {
    let entries = bounded_office_entries(bytes)?;
    for (name, value) in &entries {
        if name.ends_with(".rels") {
            reject_external_relationships(value)?;
        }
    }
    let content_types = entries
        .get("[Content_Types].xml")
        .ok_or(AgentError::IoFailed)?;
    validate_xml(content_types)?;
    if expected.is_empty() {
        if entries.keys().any(|name| name.starts_with("word/media/")) {
            return Err(AgentError::IoFailed);
        }
        if let Some(rels) = entries.get("word/_rels/document.xml.rels")
            && !parse_image_relationships(rels)?.is_empty()
        {
            return Err(AgentError::IoFailed);
        }
        let document = entries
            .get("word/document.xml")
            .ok_or(AgentError::IoFailed)?;
        let (embedded_ids, extents) = parse_document_image_refs(document)?;
        if !embedded_ids.is_empty() || !extents.is_empty() {
            return Err(AgentError::IoFailed);
        }
        return Ok(());
    }
    let (default_png_content_type, content_type_overrides) =
        parse_docx_content_types(content_types)?;
    let rels = entries
        .get("word/_rels/document.xml.rels")
        .ok_or(AgentError::IoFailed)?;
    let relationships = parse_image_relationships(rels)?;
    let document = entries
        .get("word/document.xml")
        .ok_or(AgentError::IoFailed)?;
    let (embedded_ids, extents) = parse_document_image_refs(document)?;
    if embedded_ids.len() != expected.len()
        || extents.len() != expected.len()
        || relationships.len() != expected.len()
    {
        return Err(AgentError::IoFailed);
    }
    let mut referenced_media = BTreeSet::new();
    for (index, ((relationship_id, extent), expected)) in embedded_ids
        .iter()
        .zip(extents.iter())
        .zip(expected.iter())
        .enumerate()
    {
        let target = relationships
            .get(relationship_id)
            .ok_or(AgentError::IoFailed)?;
        let media_path = normalize_docx_media_target(target)?;
        let media = entries.get(&media_path).ok_or(AgentError::IoFailed)?;
        let exact_content_type = content_type_overrides
            .get(&format!("/{media_path}"))
            .map(String::as_str)
            .unwrap_or(if default_png_content_type {
                "image/png"
            } else {
                ""
            });
        if sha256(media) != expected.content_sha256
            || *extent != (expected.width_emu, expected.height_emu)
            || !media_path.starts_with("word/media/")
            || !media_path.ends_with(".png")
            || exact_content_type != "image/png"
            || index >= MAX_ASSETS_PER_REVISION
        {
            return Err(AgentError::IoFailed);
        }
        referenced_media.insert(media_path);
    }
    let packaged_media = entries
        .keys()
        .filter(|name| name.starts_with("word/media/"))
        .cloned()
        .collect::<BTreeSet<_>>();
    if packaged_media != referenced_media {
        return Err(AgentError::IoFailed);
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PptxPictureFact {
    relationship_id: String,
    rect: SlideRect,
}

fn validate_pptx_png_media(
    bytes: &[u8],
    expected: &[ExpectedPresentationMedia],
) -> Result<(), AgentError> {
    let entries = bounded_office_entries(bytes)?;
    for (name, value) in &entries {
        if name.ends_with(".rels") {
            reject_external_relationships(value)?;
        }
    }
    let content_types = entries
        .get("[Content_Types].xml")
        .ok_or(AgentError::IoFailed)?;
    validate_xml(content_types)?;
    let (default_png_content_type, content_type_overrides) =
        parse_docx_content_types(content_types)?;
    let mut expected_by_slide = BTreeMap::<usize, Vec<&ExpectedPresentationMedia>>::new();
    for item in expected {
        expected_by_slide
            .entry(item.slide_index)
            .or_default()
            .push(item);
    }
    let mut referenced_media = BTreeSet::new();
    let slide_count = entries
        .keys()
        .filter(|name| {
            name.starts_with("ppt/slides/slide")
                && name.ends_with(".xml")
                && !name.contains("/_rels/")
        })
        .count();
    for slide_index in 0..slide_count {
        let slide_number = slide_index + 1;
        let slide_path = format!("ppt/slides/slide{slide_number}.xml");
        let rels_path = format!("ppt/slides/_rels/slide{slide_number}.xml.rels");
        let slide = entries.get(&slide_path).ok_or(AgentError::IoFailed)?;
        let pictures = parse_pptx_picture_refs(slide)?;
        let relationships = entries
            .get(&rels_path)
            .map(|value| parse_image_relationships(value))
            .transpose()?
            .unwrap_or_default();
        let expected_slide = expected_by_slide.remove(&slide_index).unwrap_or_default();
        if pictures.len() != expected_slide.len() || relationships.len() != expected_slide.len() {
            return Err(AgentError::IoFailed);
        }
        for (picture, expected) in pictures.iter().zip(expected_slide) {
            let target = relationships
                .get(&picture.relationship_id)
                .ok_or(AgentError::IoFailed)?;
            let media_path = normalize_pptx_media_target(target)?;
            let media = entries.get(&media_path).ok_or(AgentError::IoFailed)?;
            let exact_content_type = content_type_overrides
                .get(&format!("/{media_path}"))
                .map(String::as_str)
                .unwrap_or(if default_png_content_type {
                    "image/png"
                } else {
                    ""
                });
            if picture.rect != expected.rect
                || sha256(media) != expected.content_sha256
                || !media_path.starts_with("ppt/media/")
                || !media_path.ends_with(".png")
                || exact_content_type != "image/png"
                || !SlideMetrics::widescreen().slide.contains(picture.rect)
            {
                return Err(AgentError::IoFailed);
            }
            referenced_media.insert(media_path);
        }
    }
    if !expected_by_slide.is_empty() {
        return Err(AgentError::IoFailed);
    }
    let packaged_media = entries
        .keys()
        .filter(|name| name.starts_with("ppt/media/"))
        .cloned()
        .collect::<BTreeSet<_>>();
    if packaged_media != referenced_media {
        return Err(AgentError::IoFailed);
    }
    Ok(())
}

fn bounded_office_entries(bytes: &[u8]) -> Result<BTreeMap<String, Vec<u8>>, AgentError> {
    let mut archive = ZipArchive::new(Cursor::new(bytes)).map_err(|_| AgentError::IoFailed)?;
    let mut entries = BTreeMap::<String, Vec<u8>>::new();
    let mut expanded_total = 0u64;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|_| AgentError::IoFailed)?;
        if entry.is_dir() {
            continue;
        }
        if entry.size() > MAX_OUTPUT_BYTES as u64 {
            return Err(AgentError::IoFailed);
        }
        expanded_total = expanded_total
            .checked_add(entry.size())
            .ok_or(AgentError::IoFailed)?;
        if expanded_total > MAX_OUTPUT_BYTES as u64 {
            return Err(AgentError::IoFailed);
        }
        let name = entry.name().replace('\\', "/");
        if name.starts_with('/')
            || name.split('/').any(|part| part == "..")
            || entries.contains_key(&name)
        {
            return Err(AgentError::IoFailed);
        }
        let mut value = Vec::with_capacity(entry.size() as usize);
        entry
            .read_to_end(&mut value)
            .map_err(|_| AgentError::IoFailed)?;
        entries.insert(name, value);
    }
    Ok(entries)
}

fn reject_external_relationships(bytes: &[u8]) -> Result<(), AgentError> {
    let mut reader = XmlReader::from_reader(bytes);
    reader.config_mut().trim_text(true);
    loop {
        match reader.read_event().map_err(|_| AgentError::IoFailed)? {
            XmlEvent::Empty(event) | XmlEvent::Start(event)
                if event.name().as_ref().ends_with(b"Relationship") =>
            {
                for attribute in event.attributes().with_checks(true) {
                    let attribute = attribute.map_err(|_| AgentError::IoFailed)?;
                    if attribute.key.as_ref() == b"TargetMode" {
                        return Err(AgentError::IoFailed);
                    }
                }
            }
            XmlEvent::DocType(_) | XmlEvent::PI(_) | XmlEvent::CData(_) => {
                return Err(AgentError::IoFailed);
            }
            XmlEvent::Eof => return Ok(()),
            _ => {}
        }
    }
}

fn parse_pptx_picture_refs(bytes: &[u8]) -> Result<Vec<PptxPictureFact>, AgentError> {
    #[derive(Default)]
    struct PendingPicture {
        relationship_id: Option<String>,
        x: Option<i64>,
        y: Option<i64>,
        width: Option<i64>,
        height: Option<i64>,
    }
    fn attribute(
        event: &quick_xml::events::BytesStart<'_>,
        suffix: &[u8],
    ) -> Result<Option<String>, AgentError> {
        for attribute in event.attributes().with_checks(true) {
            let attribute = attribute.map_err(|_| AgentError::IoFailed)?;
            if attribute.key.as_ref().ends_with(suffix) {
                return std::str::from_utf8(attribute.value.as_ref())
                    .map(str::to_owned)
                    .map(Some)
                    .map_err(|_| AgentError::IoFailed);
            }
        }
        Ok(None)
    }
    let mut reader = XmlReader::from_reader(bytes);
    reader.config_mut().trim_text(true);
    let mut current: Option<PendingPicture> = None;
    let mut pictures = Vec::new();
    loop {
        match reader.read_event().map_err(|_| AgentError::IoFailed)? {
            XmlEvent::Start(event) if event.local_name().as_ref() == b"pic" => {
                if current.replace(PendingPicture::default()).is_some() {
                    return Err(AgentError::IoFailed);
                }
            }
            XmlEvent::Start(event) | XmlEvent::Empty(event)
                if current.is_some() && event.local_name().as_ref() == b"blip" =>
            {
                current
                    .as_mut()
                    .ok_or(AgentError::IoFailed)?
                    .relationship_id = attribute(&event, b"embed")?;
            }
            XmlEvent::Start(event) | XmlEvent::Empty(event)
                if current.is_some() && event.local_name().as_ref() == b"off" =>
            {
                let pending = current.as_mut().ok_or(AgentError::IoFailed)?;
                pending.x = attribute(&event, b"x")?
                    .map(|value| value.parse::<i64>().map_err(|_| AgentError::IoFailed))
                    .transpose()?;
                pending.y = attribute(&event, b"y")?
                    .map(|value| value.parse::<i64>().map_err(|_| AgentError::IoFailed))
                    .transpose()?;
            }
            XmlEvent::Start(event) | XmlEvent::Empty(event)
                if current.is_some() && event.local_name().as_ref() == b"ext" =>
            {
                let pending = current.as_mut().ok_or(AgentError::IoFailed)?;
                pending.width = attribute(&event, b"cx")?
                    .map(|value| value.parse::<i64>().map_err(|_| AgentError::IoFailed))
                    .transpose()?;
                pending.height = attribute(&event, b"cy")?
                    .map(|value| value.parse::<i64>().map_err(|_| AgentError::IoFailed))
                    .transpose()?;
            }
            XmlEvent::End(event) if event.local_name().as_ref() == b"pic" => {
                let pending = current.take().ok_or(AgentError::IoFailed)?;
                pictures.push(PptxPictureFact {
                    relationship_id: pending.relationship_id.ok_or(AgentError::IoFailed)?,
                    rect: SlideRect {
                        x: pending.x.ok_or(AgentError::IoFailed)?,
                        y: pending.y.ok_or(AgentError::IoFailed)?,
                        width: pending.width.ok_or(AgentError::IoFailed)?,
                        height: pending.height.ok_or(AgentError::IoFailed)?,
                    },
                });
            }
            XmlEvent::DocType(_) | XmlEvent::PI(_) | XmlEvent::CData(_) => {
                return Err(AgentError::IoFailed);
            }
            XmlEvent::Eof => break,
            _ => {}
        }
    }
    if current.is_some() {
        return Err(AgentError::IoFailed);
    }
    Ok(pictures)
}

fn normalize_pptx_media_target(target: &str) -> Result<String, AgentError> {
    let target = target.replace('\\', "/");
    let media = target
        .strip_prefix("../media/")
        .ok_or(AgentError::IoFailed)?;
    if media.is_empty()
        || media.contains('/')
        || media.contains("://")
        || media == "."
        || media == ".."
    {
        return Err(AgentError::IoFailed);
    }
    Ok(format!("ppt/media/{media}"))
}

fn validate_xml(bytes: &[u8]) -> Result<(), AgentError> {
    let mut reader = XmlReader::from_reader(bytes);
    reader.config_mut().trim_text(true);
    loop {
        if reader.read_event().map_err(|_| AgentError::IoFailed)? == XmlEvent::Eof {
            return Ok(());
        }
    }
}

fn parse_docx_content_types(bytes: &[u8]) -> Result<(bool, BTreeMap<String, String>), AgentError> {
    let mut reader = XmlReader::from_reader(bytes);
    reader.config_mut().trim_text(true);
    let mut default_png = None;
    let mut overrides = BTreeMap::new();
    loop {
        match reader.read_event().map_err(|_| AgentError::IoFailed)? {
            XmlEvent::Empty(event) | XmlEvent::Start(event) => {
                let is_default = event.name().as_ref().ends_with(b"Default");
                let is_override = event.name().as_ref().ends_with(b"Override");
                if !is_default && !is_override {
                    continue;
                }
                let mut extension = None;
                let mut part_name = None;
                let mut content_type = None;
                for attribute in event.attributes().with_checks(true) {
                    let attribute = attribute.map_err(|_| AgentError::IoFailed)?;
                    let value = std::str::from_utf8(attribute.value.as_ref())
                        .map_err(|_| AgentError::IoFailed)?
                        .to_owned();
                    match attribute.key.as_ref() {
                        b"Extension" => extension = Some(value),
                        b"PartName" => part_name = Some(value),
                        b"ContentType" => content_type = Some(value),
                        _ => {}
                    }
                }
                if is_default && extension.as_deref() == Some("png") {
                    let value = content_type.ok_or(AgentError::IoFailed)?;
                    if default_png.replace(value == "image/png").is_some() {
                        return Err(AgentError::IoFailed);
                    }
                } else if is_override {
                    let part_name = part_name.ok_or(AgentError::IoFailed)?;
                    let content_type = content_type.ok_or(AgentError::IoFailed)?;
                    if overrides.insert(part_name, content_type).is_some() {
                        return Err(AgentError::IoFailed);
                    }
                }
            }
            XmlEvent::Eof => break,
            _ => {}
        }
    }
    Ok((default_png.unwrap_or(false), overrides))
}

fn parse_image_relationships(bytes: &[u8]) -> Result<BTreeMap<String, String>, AgentError> {
    let mut reader = XmlReader::from_reader(bytes);
    reader.config_mut().trim_text(true);
    let mut images = BTreeMap::new();
    loop {
        match reader.read_event().map_err(|_| AgentError::IoFailed)? {
            XmlEvent::Empty(event) | XmlEvent::Start(event)
                if event.name().as_ref().ends_with(b"Relationship") =>
            {
                let mut id = None;
                let mut target = None;
                let mut relation_type = None;
                let mut target_mode = None;
                for attribute in event.attributes().with_checks(true) {
                    let attribute = attribute.map_err(|_| AgentError::IoFailed)?;
                    let value = std::str::from_utf8(attribute.value.as_ref())
                        .map_err(|_| AgentError::IoFailed)?
                        .to_owned();
                    match attribute.key.as_ref() {
                        b"Id" => id = Some(value),
                        b"Target" => target = Some(value),
                        b"Type" => relation_type = Some(value),
                        b"TargetMode" => target_mode = Some(value),
                        _ => {}
                    }
                }
                if relation_type
                    .as_deref()
                    .is_some_and(|value| value.ends_with("/image"))
                {
                    if target_mode.is_some() {
                        return Err(AgentError::IoFailed);
                    }
                    let id = id.ok_or(AgentError::IoFailed)?;
                    let target = target.ok_or(AgentError::IoFailed)?;
                    if images.insert(id, target).is_some() {
                        return Err(AgentError::IoFailed);
                    }
                }
            }
            XmlEvent::Eof => break,
            _ => {}
        }
    }
    Ok(images)
}

fn parse_document_image_refs(bytes: &[u8]) -> Result<DocumentImageReferences, AgentError> {
    let mut reader = XmlReader::from_reader(bytes);
    reader.config_mut().trim_text(true);
    let mut embeds = Vec::new();
    let mut extents = Vec::new();
    loop {
        match reader.read_event().map_err(|_| AgentError::IoFailed)? {
            XmlEvent::Empty(event) | XmlEvent::Start(event) => {
                let name = event.name();
                if name.as_ref().ends_with(b"blip") {
                    for attribute in event.attributes().with_checks(true) {
                        let attribute = attribute.map_err(|_| AgentError::IoFailed)?;
                        if attribute.key.as_ref().ends_with(b"embed") {
                            embeds.push(
                                std::str::from_utf8(attribute.value.as_ref())
                                    .map_err(|_| AgentError::IoFailed)?
                                    .to_owned(),
                            );
                        }
                    }
                } else if name.as_ref().ends_with(b"extent") {
                    let mut cx = None;
                    let mut cy = None;
                    for attribute in event.attributes().with_checks(true) {
                        let attribute = attribute.map_err(|_| AgentError::IoFailed)?;
                        let value = std::str::from_utf8(attribute.value.as_ref())
                            .map_err(|_| AgentError::IoFailed)?
                            .parse::<u64>()
                            .map_err(|_| AgentError::IoFailed)?;
                        match attribute.key.as_ref() {
                            b"cx" => cx = Some(value),
                            b"cy" => cy = Some(value),
                            _ => {}
                        }
                    }
                    if let (Some(cx), Some(cy)) = (cx, cy)
                        && cx > 0
                        && cy > 0
                        && cx <= DOCUMENT_MAX_IMAGE_WIDTH_EMU
                        && cy <= DOCUMENT_MAX_IMAGE_HEIGHT_EMU
                    {
                        extents.push((cx, cy));
                    }
                }
            }
            XmlEvent::Eof => break,
            _ => {}
        }
    }
    Ok((embeds, extents))
}

fn normalize_docx_media_target(target: &str) -> Result<String, AgentError> {
    let target = target.replace('\\', "/");
    if target.is_empty()
        || target.starts_with('/')
        || target.contains("://")
        || target
            .split('/')
            .any(|part| part.is_empty() || part == "..")
    {
        return Err(AgentError::IoFailed);
    }
    Ok(format!("word/{target}"))
}

fn escape_xml_text(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn compact_whitespace(text: &str) -> String {
    text.chars()
        .filter(|character| !character.is_whitespace())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{PolicyEngine, ToolExecutor, coding_tool_catalog};
    use fielora_contracts::{
        AgentPermission, AgentPolicyDecision, AgentRunId, AgentToolEffect, ArtifactId,
        ArtifactMutationKind, ArtifactRevisionId, ArtifactRevisionView, ArtifactView,
        ConversationId, DeviceId, ProfileId, ToolCallId,
    };

    #[cfg(windows)]
    fn create_directory_link(link: &Path, target: &Path) {
        let status = std::process::Command::new("cmd.exe")
            .args(["/D", "/C", "mklink", "/J"])
            .arg(link)
            .arg(target)
            .status()
            .unwrap();
        assert!(status.success());
    }

    #[cfg(unix)]
    fn create_directory_link(link: &Path, target: &Path) {
        std::os::unix::fs::symlink(target, link).unwrap();
    }

    fn fixture_runtime() -> (std::path::PathBuf, ToolRuntime) {
        let root = std::env::temp_dir().join(format!("fielora-artifact-export-{}", Uuid::now_v7()));
        fs::create_dir_all(&root).unwrap();
        let runtime = ToolRuntime::new(&root, &root.join("tool-artifacts")).unwrap();
        (root, runtime)
    }

    fn png_fixture(width: u32, height: u32, rgba: [u8; 4]) -> Vec<u8> {
        let mut bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut bytes, width, height);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().unwrap();
            let pixels = (0..u64::from(width) * u64::from(height))
                .flat_map(|_| rgba)
                .collect::<Vec<_>>();
            writer.write_image_data(&pixels).unwrap();
        }
        bytes
    }

    fn docx_media_digests(bytes: &[u8]) -> Vec<String> {
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        let mut media = Vec::new();
        for index in 0..archive.len() {
            let mut entry = archive.by_index(index).unwrap();
            if entry.name().starts_with("word/media/") {
                let name = entry.name().to_owned();
                let mut bytes = Vec::new();
                entry.read_to_end(&mut bytes).unwrap();
                media.push((name, sha256(&bytes)));
            }
        }
        media.sort_by(|left, right| left.0.cmp(&right.0));
        media.into_iter().map(|(_, digest)| digest).collect()
    }

    fn pptx_media_digests(bytes: &[u8]) -> Vec<String> {
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        let mut media = Vec::new();
        for index in 0..archive.len() {
            let mut entry = archive.by_index(index).unwrap();
            if entry.name().starts_with("ppt/media/") {
                let name = entry.name().to_owned();
                let mut bytes = Vec::new();
                entry.read_to_end(&mut bytes).unwrap();
                media.push((name, sha256(&bytes)));
            }
        }
        media.sort_by(|left, right| left.0.cmp(&right.0));
        media.into_iter().map(|(_, digest)| digest).collect()
    }

    #[test]
    fn presentation_png_uses_durable_asset_snapshot_and_historical_revision() {
        let (root, runtime) = fixture_runtime();
        let runtime = runtime.with_content_blob_root(root.join("library"));
        let admitted_a =
            crate::png_admission::admit(png_fixture(64, 32, [25, 90, 180, 255])).unwrap();
        let admitted_b =
            crate::png_admission::admit(png_fixture(32, 64, [190, 60, 25, 255])).unwrap();
        let asset_a = AssetView {
            asset_id: fielora_contracts::AssetId::new("presentation-asset-a"),
            profile_id: ProfileId::new("profile"),
            media_type: AssetMediaType::Png,
            content_sha256: admitted_a.content_sha256.clone(),
            byte_length: admitted_a.byte_length,
            width: admitted_a.width,
            height: admitted_a.height,
            blob_ref: runtime
                .put_asset_blob(admitted_a.bytes(), &admitted_a.content_sha256)
                .unwrap(),
            created_from_conversation_id: None,
            created_by_agent_run_id: None,
            created_by_tool_call_id: ToolCallId::new("presentation-asset-tool-a"),
            created_at: 1,
        };
        let asset_b = AssetView {
            asset_id: fielora_contracts::AssetId::new("presentation-asset-b"),
            profile_id: ProfileId::new("profile"),
            media_type: AssetMediaType::Png,
            content_sha256: admitted_b.content_sha256.clone(),
            byte_length: admitted_b.byte_length,
            width: admitted_b.width,
            height: admitted_b.height,
            blob_ref: runtime
                .put_asset_blob(admitted_b.bytes(), &admitted_b.content_sha256)
                .unwrap(),
            created_from_conversation_id: None,
            created_by_agent_run_id: None,
            created_by_tool_call_id: ToolCallId::new("presentation-asset-tool-b"),
            created_at: 2,
        };
        let presentation = |asset: &AssetView, title: &str| PresentationArtifact {
            slides: vec![PresentationSlide {
                layout: PresentationLayout::TitleAndBody,
                title: title.into(),
                regions: vec![SlideRegion {
                    slot: SlideSlot::Body,
                    blocks: vec![PresentationBlock::Image {
                        source: ArtifactAssetRefV1 {
                            asset_id: asset.asset_id.clone(),
                            content_sha256: asset.content_sha256.clone(),
                            media_type: asset.media_type,
                            byte_length: asset.byte_length,
                        },
                        fit: PresentationImageFitV1::Contain,
                    }],
                }],
            }],
        };
        let make_read = |presentation: &PresentationArtifact,
                         revision_id: &str,
                         sequence: u64,
                         current_revision_id: &str| {
            let canonical = canonicalize_content(
                DurableArtifactType::Presentation,
                serde_json::to_value(presentation).unwrap(),
            )
            .unwrap();
            ArtifactReadView {
                artifact: ArtifactView {
                    artifact_id: ArtifactId::new("presentation-history"),
                    profile_id: ProfileId::new("profile"),
                    artifact_type: DurableArtifactType::Presentation,
                    title: Some("Presentation history".into()),
                    project_field_id: None,
                    current_revision_id: ArtifactRevisionId::new(current_revision_id),
                    created_from_conversation_id: None,
                    created_by_agent_run_id: None,
                    updated_by_device: DeviceId::new("device"),
                    created_at: 1,
                    updated_at: sequence as i64,
                    archived_at: None,
                },
                revision: ArtifactRevisionView {
                    revision_id: ArtifactRevisionId::new(revision_id),
                    artifact_id: ArtifactId::new("presentation-history"),
                    sequence,
                    parent_revision_id: (sequence > 1)
                        .then(|| ArtifactRevisionId::new("presentation-r1")),
                    mutation_kind: if sequence == 1 {
                        ArtifactMutationKind::Create
                    } else {
                        ArtifactMutationKind::Update
                    },
                    content_schema_version: 1,
                    semantic_sha256: canonical.semantic_sha256,
                    content: canonical.content,
                    created_from_conversation_id: None,
                    created_by_agent_run_id: None,
                    created_by_tool_call_id: ToolCallId::new(format!(
                        "presentation-tool-{sequence}"
                    )),
                    created_at: sequence as i64,
                },
            }
        };
        let presentation_r1 = presentation(&asset_a, "Historical image A");
        let presentation_r2 = presentation(&asset_b, "Historical image B");
        let read_r1 = make_read(&presentation_r1, "presentation-r1", 1, "presentation-r2");
        let read_r2 = make_read(&presentation_r2, "presentation-r2", 2, "presentation-r2");
        for (read, presentation, output) in [
            (&read_r1, &presentation_r1, "presentation-r1.pptx"),
            (&read_r2, &presentation_r2, "presentation-r2.pptx"),
            (&read_r1, &presentation_r1, "presentation-r1-again.pptx"),
        ] {
            let assets = resolve_artifact_assets(&read.revision.content, |asset_id| {
                if asset_id == &asset_a.asset_id {
                    Ok(asset_a.clone())
                } else if asset_id == &asset_b.asset_id {
                    Ok(asset_b.clone())
                } else {
                    Err(AgentError::AssetNotFound)
                }
            })
            .unwrap();
            let execution = export_saved_presentation_with_assets(
                &runtime,
                read,
                &assets,
                output,
                &CommandCancellation::default(),
            )
            .unwrap();
            assert_eq!(
                execution.receipt["renderer_version"],
                PRESENTATION_RENDERER_VERSION
            );
            assert_eq!(execution.receipt["pptx_media_reopen"], "PASS");
            let plans = plan_presentation(presentation).unwrap();
            let snapshot = resolve_png_snapshots(&runtime, &assets).unwrap();
            validate_pptx_png_media(
                &fs::read(root.join(output)).unwrap(),
                &expected_presentation_media(&plans, &snapshot).unwrap(),
            )
            .unwrap();
        }
        assert_eq!(
            pptx_media_digests(&fs::read(root.join("presentation-r1.pptx")).unwrap()),
            vec![asset_a.content_sha256.clone()]
        );
        assert_eq!(
            pptx_media_digests(&fs::read(root.join("presentation-r2.pptx")).unwrap()),
            vec![asset_b.content_sha256.clone()]
        );
        assert_eq!(
            pptx_media_digests(&fs::read(root.join("presentation-r1-again.pptx")).unwrap()),
            vec![asset_a.content_sha256.clone()]
        );
        assert_eq!(
            resolve_artifact_assets(&ArtifactContentV1::Presentation(presentation_r1), |_| {
                Err(AgentError::AssetNotFound)
            })
            .unwrap_err(),
            AgentError::AssetNotFound
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn document_inline_png_uses_exact_immutable_asset_and_production_media_reopen() {
        let (root, runtime) = fixture_runtime();
        let runtime = runtime.with_content_blob_root(root.join("library"));
        let png = crate::png_admission::admit(png_fixture(32, 24, [20, 80, 160, 255])).unwrap();
        let blob_ref = runtime
            .put_asset_blob(png.bytes(), &png.content_sha256)
            .unwrap();
        let asset = AssetView {
            asset_id: fielora_contracts::AssetId::new("asset-a"),
            profile_id: ProfileId::new("profile"),
            media_type: AssetMediaType::Png,
            content_sha256: png.content_sha256.clone(),
            byte_length: png.byte_length,
            width: png.width,
            height: png.height,
            blob_ref,
            created_from_conversation_id: None,
            created_by_agent_run_id: None,
            created_by_tool_call_id: ToolCallId::new("asset-tool"),
            created_at: 1,
        };
        let png_b = crate::png_admission::admit(png_fixture(24, 32, [180, 40, 20, 255])).unwrap();
        let blob_ref_b = runtime
            .put_asset_blob(png_b.bytes(), &png_b.content_sha256)
            .unwrap();
        let asset_b = AssetView {
            asset_id: fielora_contracts::AssetId::new("asset-b"),
            profile_id: ProfileId::new("profile"),
            media_type: AssetMediaType::Png,
            content_sha256: png_b.content_sha256.clone(),
            byte_length: png_b.byte_length,
            width: png_b.width,
            height: png_b.height,
            blob_ref: blob_ref_b,
            created_from_conversation_id: None,
            created_by_agent_run_id: None,
            created_by_tool_call_id: ToolCallId::new("asset-tool-b"),
            created_at: 2,
        };
        let reference = ArtifactAssetRefV1 {
            asset_id: asset.asset_id.clone(),
            content_sha256: asset.content_sha256.clone(),
            media_type: AssetMediaType::Png,
            byte_length: asset.byte_length,
        };
        let reference_b = ArtifactAssetRefV1 {
            asset_id: asset_b.asset_id.clone(),
            content_sha256: asset_b.content_sha256.clone(),
            media_type: AssetMediaType::Png,
            byte_length: asset_b.byte_length,
        };
        let document = DocumentArtifact {
            title: Some("Durable PNG document".into()),
            blocks: vec![
                DocumentBlock::Heading {
                    level: 1,
                    text: "Before image".into(),
                },
                DocumentBlock::InlineImage {
                    source: reference.clone(),
                    size_intent: fielora_contracts::DocumentImageSizeIntentV1::DocumentWidthBounded,
                    alt_text: Some("Exact durable blue fixture".into()),
                },
                DocumentBlock::Table {
                    rows: vec![vec!["After".into(), "Table".into()]],
                },
                DocumentBlock::InlineImage {
                    source: reference,
                    size_intent: fielora_contracts::DocumentImageSizeIntentV1::DocumentWidthBounded,
                    alt_text: None,
                },
                DocumentBlock::InlineImage {
                    source: reference_b,
                    size_intent: fielora_contracts::DocumentImageSizeIntentV1::DocumentWidthBounded,
                    alt_text: Some("Second exact durable fixture".into()),
                },
            ],
        };
        let canonical = canonicalize_content(
            DurableArtifactType::Document,
            serde_json::to_value(&document).unwrap(),
        )
        .unwrap();
        let artifact_id = ArtifactId::new("document-a");
        let revision_id = ArtifactRevisionId::new("document-r1");
        let artifact = ArtifactReadView {
            artifact: ArtifactView {
                artifact_id: artifact_id.clone(),
                profile_id: ProfileId::new("profile"),
                artifact_type: DurableArtifactType::Document,
                title: document.title.clone(),
                project_field_id: None,
                current_revision_id: revision_id.clone(),
                created_from_conversation_id: None,
                created_by_agent_run_id: None,
                updated_by_device: DeviceId::new("device"),
                created_at: 1,
                updated_at: 1,
                archived_at: None,
            },
            revision: ArtifactRevisionView {
                revision_id,
                artifact_id,
                sequence: 1,
                parent_revision_id: None,
                mutation_kind: ArtifactMutationKind::Create,
                content_schema_version: 1,
                semantic_sha256: canonical.semantic_sha256,
                content: canonical.content,
                created_from_conversation_id: None,
                created_by_agent_run_id: None,
                created_by_tool_call_id: ToolCallId::new("document-tool"),
                created_at: 1,
            },
        };
        let composition = resolve_document_composition(&document, |_, _| unreachable!()).unwrap();
        let assets =
            resolve_artifact_assets(&ArtifactContentV1::Document(document.clone()), |asset_id| {
                if asset_id == &asset.asset_id {
                    Ok(asset.clone())
                } else if asset_id == &asset_b.asset_id {
                    Ok(asset_b.clone())
                } else {
                    Err(AgentError::AssetNotFound)
                }
            })
            .unwrap();
        let mut mismatched = document.clone();
        let DocumentBlock::InlineImage { source, .. } = &mut mismatched.blocks[1] else {
            unreachable!()
        };
        source.content_sha256 = "0".repeat(64);
        assert_eq!(
            resolve_artifact_assets(&ArtifactContentV1::Document(mismatched), |_| {
                Ok(asset.clone())
            })
            .unwrap_err(),
            AgentError::ArtifactReferenceIntegrityFailed
        );
        assert_eq!(
            resolve_artifact_assets(&ArtifactContentV1::Document(document.clone()), |_| {
                Err(AgentError::AssetNotFound)
            })
            .unwrap_err(),
            AgentError::AssetNotFound
        );
        let snapshot = assets
            .assets
            .iter()
            .map(|fact| ResolvedPngBytes {
                fact: fact.clone(),
                bytes: if fact.asset_id == asset.asset_id {
                    png.bytes().to_vec()
                } else {
                    png_b.bytes().to_vec()
                },
            })
            .collect::<Vec<_>>();
        let rendered = render_document_with_assets(&document, &snapshot).unwrap();
        validate_rendered(
            &ArtifactDefinition::Document(document.clone()),
            &rendered.bytes,
        )
        .expect("generic DOCX reopen");
        let preflight_media = expected_document_media(&document, &snapshot).unwrap();
        validate_docx_png_media(&rendered.bytes, &preflight_media).expect("PNG media reopen");
        let execution = export_saved_document_composition_with_assets(
            &runtime,
            &artifact,
            &composition,
            &assets,
            "inline-images.docx",
            &CommandCancellation::default(),
        )
        .unwrap();
        assert_eq!(execution.receipt["asset_count"], 3);
        assert_eq!(execution.receipt["unique_asset_count"], 2);
        assert_eq!(
            execution.receipt["asset_export_revalidation"],
            "LENGTH_SHA256_AND_STATIC_PNG_STRUCTURE"
        );
        let bytes = fs::read(root.join("inline-images.docx")).unwrap();
        let expected = expected_document_media(&document, &snapshot).unwrap();
        validate_docx_png_media(&bytes, &expected).unwrap();

        let history_document = |source: ArtifactAssetRefV1, label: &str| DocumentArtifact {
            title: Some(label.into()),
            blocks: vec![DocumentBlock::InlineImage {
                source,
                size_intent: fielora_contracts::DocumentImageSizeIntentV1::DocumentWidthBounded,
                alt_text: Some(label.into()),
            }],
        };
        let document_r1 = history_document(
            ArtifactAssetRefV1 {
                asset_id: asset.asset_id.clone(),
                content_sha256: asset.content_sha256.clone(),
                media_type: asset.media_type,
                byte_length: asset.byte_length,
            },
            "Historical R1",
        );
        let document_r2 = history_document(
            ArtifactAssetRefV1 {
                asset_id: asset_b.asset_id.clone(),
                content_sha256: asset_b.content_sha256.clone(),
                media_type: asset_b.media_type,
                byte_length: asset_b.byte_length,
            },
            "Historical R2",
        );
        let r1_canonical = canonicalize_content(
            DurableArtifactType::Document,
            serde_json::to_value(&document_r1).unwrap(),
        )
        .unwrap();
        let r2_canonical = canonicalize_content(
            DurableArtifactType::Document,
            serde_json::to_value(&document_r2).unwrap(),
        )
        .unwrap();
        let r1_id = ArtifactRevisionId::new("history-r1");
        let r2_id = ArtifactRevisionId::new("history-r2");
        let mut history_r1 = artifact.clone();
        history_r1.artifact.current_revision_id = r2_id.clone();
        history_r1.revision.revision_id = r1_id.clone();
        history_r1.revision.sequence = 1;
        history_r1.revision.semantic_sha256 = r1_canonical.semantic_sha256;
        history_r1.revision.content = r1_canonical.content;
        let mut history_r2 = history_r1.clone();
        history_r2.revision.revision_id = r2_id;
        history_r2.revision.sequence = 2;
        history_r2.revision.parent_revision_id = Some(r1_id);
        history_r2.revision.mutation_kind = ArtifactMutationKind::Update;
        history_r2.revision.semantic_sha256 = r2_canonical.semantic_sha256;
        history_r2.revision.content = r2_canonical.content;
        for (view, document, output) in [
            (&history_r1, &document_r1, "history-r1.docx"),
            (&history_r2, &document_r2, "history-r2.docx"),
            (&history_r1, &document_r1, "history-r1-again.docx"),
        ] {
            let composition =
                resolve_document_composition(document, |_, _| unreachable!()).unwrap();
            let assets = resolve_artifact_assets(
                &ArtifactContentV1::Document(document.clone()),
                |asset_id| {
                    if asset_id == &asset.asset_id {
                        Ok(asset.clone())
                    } else if asset_id == &asset_b.asset_id {
                        Ok(asset_b.clone())
                    } else {
                        Err(AgentError::AssetNotFound)
                    }
                },
            )
            .unwrap();
            export_saved_document_composition_with_assets(
                &runtime,
                view,
                &composition,
                &assets,
                output,
                &CommandCancellation::default(),
            )
            .unwrap();
        }
        assert_eq!(
            docx_media_digests(&fs::read(root.join("history-r1.docx")).unwrap()),
            vec![asset.content_sha256.clone()]
        );
        assert_eq!(
            docx_media_digests(&fs::read(root.join("history-r2.docx")).unwrap()),
            vec![asset_b.content_sha256.clone()]
        );
        assert_eq!(
            docx_media_digests(&fs::read(root.join("history-r1-again.docx")).unwrap()),
            vec![asset.content_sha256.clone()]
        );

        let asset_blob_path = root.join("library").join(&asset.blob_ref);
        fs::write(&asset_blob_path, b"corrupt PNG bytes").unwrap();
        assert_eq!(
            export_saved_document_composition_with_assets(
                &runtime,
                &artifact,
                &composition,
                &assets,
                "corrupt-asset.docx",
                &CommandCancellation::default(),
            )
            .unwrap_err(),
            AgentError::AssetContentChanged
        );
        assert!(!root.join("corrupt-asset.docx").exists());
        fs::remove_file(asset_blob_path).unwrap();
        assert_eq!(
            export_saved_document_composition_with_assets(
                &runtime,
                &artifact,
                &composition,
                &assets,
                "missing-asset.docx",
                &CommandCancellation::default(),
            )
            .unwrap_err(),
            AgentError::AssetContentChanged
        );
        assert!(!root.join("missing-asset.docx").exists());
        fs::remove_dir_all(root).unwrap();
    }

    fn spreadsheet_revision_fixture() -> ArtifactReadView {
        let artifact_id = ArtifactId::new("spreadsheet-child");
        let revision_id = ArtifactRevisionId::new("spreadsheet-r1");
        let canonical = canonicalize_content(
            DurableArtifactType::Spreadsheet,
            json!({
                "title":"Composition fixture",
                "sheets":[{"sheet_id":"summary","name":"概览","cells":[
                    {"row":1,"column":1,"value":{"kind":"STRING","value":"项目 & <状态>"}},
                    {"row":1,"column":2,"value":{"kind":"DECIMAL","value":"0012.3400"}},
                    {"row":2,"column":1,"value":{"kind":"BOOLEAN","value":true}},
                    {"row":2,"column":2,"value":{"kind":"STRING","value":"=SUM(B2:B3)"}}
                ]}]
            }),
        )
        .unwrap();
        ArtifactReadView {
            artifact: ArtifactView {
                artifact_id: artifact_id.clone(),
                profile_id: ProfileId::new("profile"),
                artifact_type: DurableArtifactType::Spreadsheet,
                title: Some("Composition fixture".into()),
                project_field_id: None,
                current_revision_id: revision_id.clone(),
                created_from_conversation_id: None,
                created_by_agent_run_id: None,
                updated_by_device: DeviceId::new("device"),
                created_at: 1,
                updated_at: 1,
                archived_at: None,
            },
            revision: ArtifactRevisionView {
                revision_id,
                artifact_id,
                sequence: 1,
                parent_revision_id: None,
                mutation_kind: ArtifactMutationKind::Create,
                content_schema_version: 1,
                semantic_sha256: canonical.semantic_sha256,
                content: canonical.content,
                created_from_conversation_id: None,
                created_by_agent_run_id: None,
                created_by_tool_call_id: ToolCallId::new("tool"),
                created_at: 1,
            },
        }
    }

    fn spreadsheet_range_document(child: &ArtifactReadView) -> DocumentArtifact {
        DocumentArtifact {
            title: Some("Pinned child".into()),
            blocks: vec![DocumentBlock::SpreadsheetRange {
                source: SpreadsheetRangeEmbedV1 {
                    artifact_ref: fielora_contracts::ArtifactRefV1 {
                        artifact_id: child.artifact.artifact_id.clone(),
                        revision_id: child.revision.revision_id.clone(),
                        expected_type: DurableArtifactType::Spreadsheet,
                        semantic_sha256: child.revision.semantic_sha256.clone(),
                    },
                    sheet_id: fielora_contracts::SpreadsheetSheetId::new("summary"),
                    start_row: 1,
                    start_column: 1,
                    end_row: 3,
                    end_column: 3,
                },
            }],
        }
    }

    #[test]
    fn spreadsheet_range_resolution_is_exact_sparse_literal_and_deterministic() {
        let child = spreadsheet_revision_fixture();
        let document = spreadsheet_range_document(&child);
        let resolved = resolve_document_composition(&document, |artifact_id, revision_id| {
            assert_eq!(artifact_id, &child.artifact.artifact_id);
            assert_eq!(revision_id, &child.revision.revision_id);
            Ok(child.clone())
        })
        .unwrap();
        assert_eq!(resolved.dependencies.len(), 1);
        assert_eq!(resolved.dependency_set_sha256.len(), 64);
        assert_eq!(
            resolved.document.blocks,
            vec![DocumentBlock::Table {
                rows: vec![
                    vec!["项目 & <状态>".into(), "12.34".into(), "".into()],
                    vec!["TRUE".into(), "=SUM(B2:B3)".into(), "".into()],
                    vec!["".into(), "".into(), "".into()],
                ]
            }]
        );
        let repeated = resolve_document_composition(&document, |_, _| Ok(child.clone())).unwrap();
        assert_eq!(resolved, repeated);
        let definition = ArtifactDefinition::Document(resolved.document.clone());
        let rendered = render(&definition).unwrap();
        let reopened =
            Document::from_reader(Cursor::new(rendered.bytes.clone()), DocumentFormat::Docx)
                .unwrap();
        let plain_text = reopened.plain_text();
        for expected in ["项目", "状态", "12.34", "TRUE", "=SUM(B2:B3)"] {
            assert!(
                plain_text.contains(expected),
                "missing {expected}: {plain_text:?}"
            );
        }
        let mut archive = ZipArchive::new(Cursor::new(&rendered.bytes)).unwrap();
        let mut document_xml = String::new();
        archive
            .by_name("word/document.xml")
            .unwrap()
            .read_to_string(&mut document_xml)
            .unwrap();
        assert!(document_xml.contains("项目 &amp; &lt;状态&gt;"));
        validate_rendered(&definition, &rendered.bytes).unwrap();
    }

    #[test]
    fn spreadsheet_range_resolution_fails_closed_on_reference_mismatch() {
        let child = spreadsheet_revision_fixture();
        let mut wrong_digest = spreadsheet_range_document(&child);
        let DocumentBlock::SpreadsheetRange { source } = &mut wrong_digest.blocks[0] else {
            unreachable!()
        };
        source.artifact_ref.semantic_sha256 = "0".repeat(64);
        assert_eq!(
            resolve_document_composition(&wrong_digest, |_, _| Ok(child.clone())),
            Err(AgentError::ArtifactReferenceIntegrityFailed)
        );

        let mut wrong_type = spreadsheet_range_document(&child);
        let DocumentBlock::SpreadsheetRange { source } = &mut wrong_type.blocks[0] else {
            unreachable!()
        };
        source.artifact_ref.expected_type = DurableArtifactType::Document;
        assert_eq!(
            resolve_document_composition(&wrong_type, |_, _| Ok(child.clone())),
            Err(AgentError::ArtifactReferenceTypeMismatch)
        );

        let mut wrong_range = spreadsheet_range_document(&child);
        let DocumentBlock::SpreadsheetRange { source } = &mut wrong_range.blocks[0] else {
            unreachable!()
        };
        source.end_row = 65;
        assert_eq!(
            resolve_document_composition(&wrong_range, |_, _| Ok(child.clone())),
            Err(AgentError::ArtifactReferenceRangeInvalid)
        );
        assert_eq!(
            resolve_document_composition(&spreadsheet_range_document(&child), |_, _| {
                Err(AgentError::ArtifactReferenceNotFound)
            }),
            Err(AgentError::ArtifactReferenceNotFound)
        );
    }

    #[test]
    fn spreadsheet_reference_identity_and_range_are_parent_digest_authority() {
        let child = spreadsheet_revision_fixture();
        let base = serde_json::to_value(spreadsheet_range_document(&child)).unwrap();
        let baseline = canonicalize_content(DurableArtifactType::Document, base.clone()).unwrap();
        for (path, replacement) in [
            (
                &["blocks", "0", "source", "artifact_ref", "artifact_id"][..],
                json!("other-artifact"),
            ),
            (
                &["blocks", "0", "source", "artifact_ref", "revision_id"][..],
                json!("other-revision"),
            ),
            (
                &["blocks", "0", "source", "artifact_ref", "expected_type"][..],
                json!("DOCUMENT"),
            ),
            (
                &["blocks", "0", "source", "artifact_ref", "semantic_sha256"][..],
                json!("0".repeat(64)),
            ),
            (
                &["blocks", "0", "source", "sheet_id"][..],
                json!("other-sheet"),
            ),
            (&["blocks", "0", "source", "end_row"][..], json!(4)),
        ] {
            let mut changed = base.clone();
            let mut target = &mut changed;
            for segment in &path[..path.len() - 1] {
                target = if let Ok(index) = segment.parse::<usize>() {
                    &mut target[index]
                } else {
                    &mut target[*segment]
                };
            }
            target[path[path.len() - 1]] = replacement;
            let canonical = canonicalize_content(DurableArtifactType::Document, changed).unwrap();
            assert_ne!(canonical.semantic_sha256, baseline.semantic_sha256);
        }

        let mut unknown = base;
        unknown["blocks"][0]["source"]["unexpected"] = json!(true);
        assert_eq!(
            canonicalize_content(DurableArtifactType::Document, unknown),
            Err(AgentError::ArtifactContentInvalid)
        );
    }

    #[test]
    fn exact_revision_dependency_graph_detects_cycles_and_bounds_depth() {
        let a1 = ("artifact-a".into(), "r1".into());
        let a2 = ("artifact-a".into(), "r2".into());
        let cycle = BTreeMap::from([
            (a1.clone(), vec![a2.clone()]),
            (a2.clone(), vec![a1.clone()]),
        ]);
        assert_eq!(
            validate_dependency_graph(&cycle, std::slice::from_ref(&a1)),
            Err(AgentError::ArtifactCompositionCycle)
        );

        let historical_self =
            BTreeMap::from([(a2.clone(), vec![a1.clone()]), (a1.clone(), Vec::new())]);
        assert_eq!(
            validate_dependency_graph(&historical_self, std::slice::from_ref(&a2)),
            Ok(())
        );

        let nodes = (0..=MAX_COMPOSITION_DEPTH)
            .map(|index| ("artifact".into(), format!("r{index}")))
            .collect::<Vec<_>>();
        let too_deep = nodes
            .iter()
            .enumerate()
            .map(|(index, node)| {
                (
                    node.clone(),
                    nodes.get(index + 1).cloned().into_iter().collect(),
                )
            })
            .collect::<BTreeMap<_, _>>();
        assert_eq!(
            validate_dependency_graph(&too_deep, std::slice::from_ref(&nodes[0])),
            Err(AgentError::ArtifactCompositionLimitExceeded)
        );

        let too_many_roots = (0..=MAX_TRANSITIVE_DEPENDENCIES)
            .map(|index| (format!("artifact-{index}"), "r1".into()))
            .collect::<Vec<_>>();
        let too_many = too_many_roots
            .iter()
            .cloned()
            .map(|node| (node, Vec::new()))
            .collect::<BTreeMap<_, _>>();
        assert_eq!(
            validate_dependency_graph(&too_many, &too_many_roots),
            Err(AgentError::ArtifactCompositionLimitExceeded)
        );
    }

    fn document_args(path: &str) -> Value {
        json!({
            "type":"document",
            "output_path":path,
            "content":{
                "title":"Artifact Export",
                "blocks":[
                    {"kind":"HEADING","level":2,"text":"Document Section"},
                    {"kind":"PARAGRAPH","text":"A bounded semantic paragraph."},
                    {"kind":"BULLET_LIST","items":["First item","Second item"]},
                    {"kind":"TABLE","rows":[["Metric","Value"],["Roundtrip","Present"]]}
                ]
            }
        })
    }

    fn presentation_args(path: &str) -> Value {
        json!({
            "type":"presentation",
            "output_path":path,
            "content":{"slides":[
                {"layout":"TITLE","title":"Artifact Export","regions":[]},
                {"layout":"TITLE_AND_BODY","title":"Title and body","regions":[
                    {"slot":"BODY","blocks":[
                        {"kind":"PARAGRAPH","text":"A bounded slide paragraph."},
                        {"kind":"BULLET_LIST","items":["First slide item","Second slide item"]}
                    ]}
                ]},
                {"layout":"TWO_COLUMN","title":"Two columns","regions":[
                    {"slot":"LEFT","blocks":[{"kind":"PARAGRAPH","text":"Left content"}]},
                    {"slot":"RIGHT","blocks":[{"kind":"BULLET_LIST","items":["Right content"]}]}
                ]}
            ]}
        })
    }

    fn diagram_content(label: &str) -> Value {
        json!({
            "title":"Fielora Architecture 架构",
            "description":"A bounded deterministic Diagram.",
            "layout":{"strategy":"LAYERED_AUTO","direction":"LEFT_TO_RIGHT"},
            "nodes":[
                {"node_id":"model","label":"Model 模型","semantic_kind":"SYSTEM","presentation":{"shape":"RECTANGLE","emphasis":"EMPHASIS"}},
                {"node_id":"context","label":"Context 上下文","semantic_kind":"PROCESS"},
                {"node_id":"execution","label":label,"semantic_kind":"SERVICE"},
                {"node_id":"artifact","label":"Artifact","semantic_kind":"DOCUMENT"},
                {"node_id":"detached","label":"Detached","semantic_kind":"GENERIC"}
            ],
            "edges":[
                {"edge_id":"e_model_context","source_node_id":"model","target_node_id":"context","label":"calls","relation_kind":"FLOW","direction":"FORWARD"},
                {"edge_id":"e_context_execution","source_node_id":"context","target_node_id":"execution","relation_kind":"DEPENDS_ON","direction":"FORWARD"},
                {"edge_id":"e_execution_artifact","source_node_id":"execution","target_node_id":"artifact","relation_kind":"FLOW","direction":"BIDIRECTIONAL"},
                {"edge_id":"e_cross","source_node_id":"model","target_node_id":"artifact","relation_kind":"RELATION","direction":"NONE"}
            ],
            "groups":[
                {"group_id":"reasoning","label":"Reasoning","semantic_kind":"LAYER","member_node_ids":["model"]},
                {"group_id":"harness","label":"Harness 执行层","semantic_kind":"BOUNDARY","member_node_ids":["context","execution"]},
                {"group_id":"tools","label":"Tools","semantic_kind":"CLUSTER","member_node_ids":["artifact"]}
            ]
        })
    }

    fn spreadsheet_content(number: &str, summary: &str) -> Value {
        json!({
            "title":"季度销售 & <Quarter Sales>",
            "sheets":[
                {
                    "sheet_id":"summary",
                    "name":"Summary 中英",
                    "cells":[
                        {"row":1,"column":1,"value":{"kind":"STRING","value":summary},"presentation":{"emphasis":"HEADER","alignment":"LEFT","wrap":true}},
                        {"row":3,"column":4,"value":{"kind":"BOOLEAN","value":true}}
                    ]
                },
                {
                    "sheet_id":"quarter_sales",
                    "name":"季度销售",
                    "cells":[
                        {"row":1,"column":1,"value":{"kind":"STRING","value":"中文产品 <Alpha> & English"},"presentation":{"emphasis":"HEADER","alignment":"CENTER","wrap":true}},
                        {"row":2,"column":3,"value":{"kind":"DECIMAL","value":number},"format":"DECIMAL_2"},
                        {"row":5,"column":7,"value":{"kind":"STRING","value":"=WEBSERVICE(\"https://example.com?a=1&b=2\")"}},
                        {"row":7,"column":2,"value":{"kind":"STRING","value":"@evil"}}
                    ]
                }
            ]
        })
    }

    fn presentation_from(arguments: &Value) -> PresentationArtifact {
        serde_json::from_value(arguments["content"].clone()).unwrap()
    }

    fn overflow_presentation_args(path: &str) -> Value {
        let items = (1..=64)
            .map(|index| format!("Overflow boundary item {index}"))
            .collect::<Vec<_>>();
        json!({
            "type":"presentation",
            "output_path":path,
            "content":{"slides":[{
                "layout":"TITLE_AND_BODY",
                "title":"Bounded overflow",
                "regions":[{"slot":"BODY","blocks":[{"kind":"BULLET_LIST","items":items}]}]
            }]}
        })
    }

    fn assert_no_temporary_files(root: &Path) {
        let mut pending = vec![root.to_path_buf()];
        while let Some(directory) = pending.pop() {
            for entry in fs::read_dir(directory).unwrap() {
                let entry = entry.unwrap();
                if entry.file_type().unwrap().is_dir() {
                    pending.push(entry.path());
                } else {
                    assert!(!entry.file_name().to_string_lossy().starts_with(".fielora-"));
                }
            }
        }
    }

    #[test]
    fn presentation_metrics_and_layout_plans_are_deterministic_and_bounded() {
        let metrics = SlideMetrics::widescreen();
        assert!(metrics.slide.contains(metrics.cover_title));
        assert!(metrics.slide.contains(metrics.cover_subtitle));
        assert!(metrics.slide.contains(metrics.title));
        assert!(metrics.slide.contains(metrics.body));
        assert!(!metrics.title.overlaps(metrics.body));
        assert_eq!(metrics.left.width, metrics.right.width);
        assert_eq!(metrics.right.x - metrics.left.right(), metrics.column_gap);
        assert!(!metrics.left.overlaps(metrics.right));

        let presentation = presentation_from(&presentation_args("layout.pptx"));
        let first = plan_presentation(&presentation).unwrap();
        let second = plan_presentation(&presentation).unwrap();
        assert_eq!(first, second);
        assert_eq!(first.len(), 3);
        for plan in first {
            for line in &plan.lines {
                assert!(metrics.slide.contains(line.rect), "out of bounds: {line:?}");
            }
            for (index, line) in plan.lines.iter().enumerate() {
                for other in plan.lines.iter().skip(index + 1) {
                    assert!(
                        !line.rect.overlaps(other.rect),
                        "overlap: {line:?} / {other:?}"
                    );
                }
            }
        }
    }

    #[test]
    fn presentation_typography_has_hierarchy_fonts_and_readable_floor() {
        let presentation = presentation_from(&json!({
            "content":{"slides":[
                {"layout":"TITLE","title":"Fielora\nAI-native 工作环境","regions":[]},
                {"layout":"TITLE_AND_BODY","title":"Mixed Typography","regions":[
                    {"slot":"BODY","blocks":[
                        {"kind":"PARAGRAPH","text":"Model + Harness + Tools 统一进入现有 pipeline。"},
                        {"kind":"BULLET_LIST","items":["可读的中英文正文","Provider-neutral execution"]}
                    ]}
                ]}
            ]}
        }));
        let plans = plan_presentation(&presentation).unwrap();
        let cover_title = plans[0]
            .lines
            .iter()
            .find(|line| line.style.role == PresentationTextRole::CoverTitle)
            .unwrap();
        let cover_subtitle = plans[0]
            .lines
            .iter()
            .find(|line| line.style.role == PresentationTextRole::CoverSubtitle)
            .unwrap();
        assert!(cover_title.style.font_size_pt >= 34);
        assert!(cover_title.style.font_size_pt > cover_subtitle.style.font_size_pt);
        assert!(plans[1].lines.iter().any(|line| {
            line.style.role == PresentationTextRole::SlideTitle && line.style.font_size_pt >= 26
        }));
        assert!(plans.iter().flat_map(|plan| &plan.lines).all(|line| {
            !matches!(
                line.style.role,
                PresentationTextRole::Body
                    | PresentationTextRole::Bullet
                    | PresentationTextRole::BulletMarker
            ) || line.style.font_size_pt >= 15
        }));

        let rendered = render(&ArtifactDefinition::Presentation(presentation)).unwrap();
        let mut archive = ZipArchive::new(Cursor::new(rendered.bytes)).unwrap();
        let mut slide_xml = String::new();
        std::io::Read::read_to_string(
            &mut archive.by_name("ppt/slides/slide2.xml").unwrap(),
            &mut slide_xml,
        )
        .unwrap();
        assert!(slide_xml.contains("typeface=\"Arial\""));
        assert!(slide_xml.contains("typeface=\"Microsoft YaHei\""));
        assert!(slide_xml.contains("sz=\"2800\""));
        assert!(slide_xml.contains("<a:off x=\"777240\" y=\"457200\""));
    }

    #[test]
    fn presentation_long_titles_fit_boundedly_or_fail_closed() {
        let metrics = SlideMetrics::widescreen();
        let fitted = fit_text_box(
            "A deliberately long presentation title that wraps across the available safe title region",
            metrics.title,
            &[28, 27, 26],
            2,
            PresentationTextRole::SlideTitle,
            true,
            PRIMARY_TEXT_COLOR,
        )
        .unwrap();
        assert_eq!(fitted.len(), 2);
        assert!(fitted.iter().all(|line| line.style.font_size_pt >= 26));
        assert_eq!(
            fit_text_box(
                &"W".repeat(500),
                metrics.title,
                &[28, 27, 26],
                2,
                PresentationTextRole::SlideTitle,
                true,
                PRIMARY_TEXT_COLOR,
            ),
            Err(AgentError::PresentationContentOverflow)
        );
    }

    #[test]
    fn presentation_stress_layout_fits_normal_content_and_rejects_overflow() {
        let safe = presentation_from(&json!({
            "content":{"slides":[
                {"layout":"TITLE_AND_BODY","title":"面向真实工作的 Fielora Presentation Renderer Quality Foundation 与确定性安全边界","regions":[
                    {"slot":"BODY","blocks":[
                        {"kind":"PARAGRAPH","text":"长标题在受控字号范围内换行，并与正文保持稳定间距。"}
                    ]}
                ]},
                {"layout":"TITLE_AND_BODY","title":"Ten Normal Bullets","regions":[
                    {"slot":"BODY","blocks":[
                        {"kind":"BULLET_LIST","items":[
                            "Project","Conversation","Model","Harness","Tools",
                            "PolicyEngine","Approval","Receipt","Artifact","Verification"
                        ]}
                    ]}
                ]},
                {"layout":"TITLE_AND_BODY","title":"Mixed Long Paragraph","regions":[
                    {"slot":"BODY","blocks":[
                        {"kind":"PARAGRAPH","text":"Fielora keeps Model, Harness, and Tools 与真实执行边界分离。Renderer 使用保守且确定性的 CJK / Latin 字符宽度估算，在固定安全区内规划字号、行高与段落间距；内容不会通过无限缩小字号来勉强容纳，执行成功也不会升级为事实 Verification PASS。This mixed paragraph intentionally exercises wrapping across English words, 中文标点、technical identifiers, and a normal presentation-width text region without relying on an external layout process."}
                    ]}
                ]},
                {"layout":"TWO_COLUMN","title":"Unequal Column Density","regions":[
                    {"slot":"LEFT","blocks":[
                        {"kind":"PARAGRAPH","text":"Small / 小栏"},
                        {"kind":"BULLET_LIST","items":["Coding","Files"]}
                    ]},
                    {"slot":"RIGHT","blocks":[
                        {"kind":"PARAGRAPH","text":"Dense / 长栏"},
                        {"kind":"BULLET_LIST","items":[
                            "External Tool Provider","MCP stdio transport","Agent Skills lazy loading",
                            "Web Intelligence with policy","File Intelligence extraction",
                            "Artifact structural roundtrip","Verification remains separate",
                            "Future plugins use the same Tool execution path"
                        ]}
                    ]}
                ]}
            ]}
        }));
        let plans = plan_presentation(&safe).unwrap();
        assert_eq!(plans.len(), 4);
        assert!(
            plans[0]
                .lines
                .iter()
                .filter(|line| line.style.role == PresentationTextRole::SlideTitle)
                .count()
                >= 2
        );
        assert!(
            plans
                .iter()
                .any(|plan| plan.density == ContentDensity::Normal)
        );
        let high_density_region = SlideRegion {
            slot: SlideSlot::Body,
            blocks: vec![PresentationBlock::BulletList {
                items: (1..=12).map(|index| format!("Item {index}")).collect(),
            }],
        };
        assert_eq!(
            region_density(&high_density_region, SlideMetrics::widescreen().body, false),
            ContentDensity::High
        );
        assert!(
            plan_region(
                &high_density_region,
                SlideMetrics::widescreen().body,
                16,
                false
            )
            .is_some()
        );
        let two_column_sizes = plans[3]
            .lines
            .iter()
            .filter(|line| {
                matches!(
                    line.style.role,
                    PresentationTextRole::Bullet | PresentationTextRole::BulletMarker
                )
            })
            .map(|line| line.style.font_size_pt)
            .collect::<HashSet<_>>();
        assert_eq!(two_column_sizes.len(), 1);

        let (root, runtime) = fixture_runtime();
        assert_eq!(
            runtime.execute(
                "artifact.export",
                &overflow_presentation_args("overflow.pptx"),
                false,
                &CommandCancellation::default()
            ),
            Err(AgentError::PresentationContentOverflow)
        );
        assert!(!root.join("overflow.pptx").exists());
        assert_no_temporary_files(&root);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn catalog_and_policy_reuse_workspace_write_boundary() {
        let tools = coding_tool_catalog();
        let matches = tools
            .iter()
            .filter(|tool| tool.definition.name == "artifact.export")
            .collect::<Vec<_>>();
        assert_eq!(matches.len(), 1);
        let spec = matches[0];
        assert_eq!(spec.effect, AgentToolEffect::WorkspaceWrite);
        let schema = spec.definition.input_schema.to_string();
        assert!(schema.contains("TITLE_AND_BODY"));
        assert!(schema.contains("TWO_COLUMN"));
        assert!(!schema.contains("\"x\""));
        assert!(!schema.contains("\"template\""));
        assert!(!schema.contains("SPREADSHEET_RANGE"));
        let create_schema = tools
            .iter()
            .find(|tool| tool.definition.name == "artifact.create")
            .unwrap()
            .definition
            .input_schema
            .to_string();
        assert!(create_schema.contains("SPREADSHEET_RANGE"));
        assert!(create_schema.contains("SPREADSHEET"));
        assert_eq!(
            PolicyEngine.decide(AgentPermission::ReadOnly, spec, &document_args("out.docx")),
            AgentPolicyDecision::Ask
        );
        assert_eq!(
            PolicyEngine.decide(
                AgentPermission::ReviewChanges,
                spec,
                &document_args("out.docx")
            ),
            AgentPolicyDecision::Allow
        );
    }

    #[test]
    fn document_and_presentation_export_roundtrip_through_file_extract() {
        let (root, runtime) = fixture_runtime();
        for (arguments, path, format, renderer_version, expected) in [
            (
                document_args("exports/report.docx"),
                "exports/report.docx",
                "DOCX",
                DOCUMENT_RENDERER_VERSION,
                vec!["Document Section", "First item", "Roundtrip", "Present"],
            ),
            (
                presentation_args("exports/deck.pptx"),
                "exports/deck.pptx",
                "PPTX",
                PRESENTATION_RENDERER_VERSION,
                vec![
                    "Title and body",
                    "First slide item",
                    "Left content",
                    "Right content",
                ],
            ),
        ] {
            let exported = runtime
                .execute(
                    "artifact.export",
                    &arguments,
                    false,
                    &CommandCancellation::default(),
                )
                .unwrap();
            assert_eq!(exported.receipt["kind"], "ARTIFACT_EXPORTED");
            assert_eq!(exported.receipt["structural_reopen"], "STRUCTURAL_VALID");
            assert_eq!(exported.receipt["roundtrip"], "SEMANTIC_CONTENT_PRESENT");
            assert_eq!(exported.receipt["renderer_version"], renderer_version);
            assert!(exported.receipt.get("verification_eligible").is_none());
            let receipt_text = exported.receipt.to_string();
            assert!(!receipt_text.contains("First item"));
            assert!(!receipt_text.contains("Right content"));

            let extracted = runtime
                .execute(
                    "file.extract",
                    &json!({"path":path}),
                    false,
                    &CommandCancellation::default(),
                )
                .unwrap();
            assert_eq!(extracted.receipt["format"], format);
            for text in expected {
                assert!(extracted.observation.contains(text), "missing {text}");
            }
        }
        assert_no_temporary_files(&root);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn semantic_digest_is_stable_and_excludes_path_and_identity() {
        let (root, runtime) = fixture_runtime();
        let first = runtime
            .execute(
                "artifact.export",
                &document_args("first.docx"),
                false,
                &CommandCancellation::default(),
            )
            .unwrap();
        let second = runtime
            .execute(
                "artifact.export",
                &document_args("second.docx"),
                false,
                &CommandCancellation::default(),
            )
            .unwrap();
        assert_eq!(
            first.receipt["artifact_definition_sha256"],
            second.receipt["artifact_definition_sha256"]
        );
        assert_ne!(first.receipt["artifact_id"], second.receipt["artifact_id"]);
        assert_no_temporary_files(&root);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn invalid_definition_bounds_layout_and_paths_fail_closed() {
        let (root, runtime) = fixture_runtime();
        let cancellation = CommandCancellation::default();
        for invalid in [
            json!({"type":"spreadsheet","content":{},"output_path":"out.xlsx"}),
            json!({"type":"document","content":{"blocks":[]},"output_path":"out.docx"}),
            json!({"type":"document","content":{"blocks":[{"kind":"HEADING","level":4,"text":"No"}]},"output_path":"out.docx"}),
            json!({"type":"presentation","content":{"slides":[{"layout":"TITLE","title":"Title","regions":[{"slot":"BODY","blocks":[{"kind":"PARAGRAPH","text":"Illegal"}]}]}]},"output_path":"out.pptx"}),
            json!({"type":"presentation","content":{"slides":[{"layout":"CUSTOM","title":"Title","regions":[]}]},"output_path":"out.pptx"}),
            document_args("wrong.pptx"),
        ] {
            assert_eq!(
                runtime.execute("artifact.export", &invalid, false, &cancellation),
                Err(AgentError::ToolArgumentsInvalid)
            );
        }
        for invalid_path in ["../out.docx", "C:/out.docx", "https://example.com/out.docx"] {
            assert!(
                runtime
                    .execute(
                        "artifact.export",
                        &document_args(invalid_path),
                        false,
                        &cancellation
                    )
                    .is_err()
            );
        }
        let oversized_items = (0..=MAX_LIST_ITEMS_PER_LIST)
            .map(|index| format!("item {index}"))
            .collect::<Vec<_>>();
        let oversized = json!({
            "type":"document",
            "output_path":"oversized.docx",
            "content":{"blocks":[{"kind":"BULLET_LIST","items":oversized_items}]}
        });
        assert_eq!(
            runtime.execute("artifact.export", &oversized, false, &cancellation),
            Err(AgentError::ToolArgumentsInvalid)
        );
        let oversized_input = json!({
            "type":"document",
            "output_path":"oversized-input.docx",
            "content":{"blocks":[{"kind":"PARAGRAPH","text":"x".repeat(MAX_DEFINITION_BYTES)}]}
        });
        assert_eq!(
            runtime.execute("artifact.export", &oversized_input, false, &cancellation),
            Err(AgentError::ToolArgumentsInvalid)
        );
        let too_many_rows = (0..=MAX_TABLE_ROWS)
            .map(|index| vec![format!("row {index}")])
            .collect::<Vec<_>>();
        let oversized_table = json!({
            "type":"document",
            "output_path":"oversized-table.docx",
            "content":{"blocks":[{"kind":"TABLE","rows":too_many_rows}]}
        });
        assert_eq!(
            runtime.execute("artifact.export", &oversized_table, false, &cancellation),
            Err(AgentError::ToolArgumentsInvalid)
        );
        assert_eq!(
            runtime.execute(
                "artifact.export",
                &document_args(".env.docx"),
                false,
                &cancellation
            ),
            Err(AgentError::SensitivePathDenied)
        );
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn existing_destination_is_not_overwritten() {
        let (root, runtime) = fixture_runtime();
        fs::write(root.join("existing.docx"), b"user bytes").unwrap();
        assert_eq!(
            runtime.execute(
                "artifact.export",
                &document_args("existing.docx"),
                false,
                &CommandCancellation::default()
            ),
            Err(AgentError::FileChanged)
        );
        assert_eq!(fs::read(root.join("existing.docx")).unwrap(), b"user bytes");
        assert_no_temporary_files(&root);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn canonical_containment_rejects_directory_link_escape() {
        let (root, runtime) = fixture_runtime();
        let outside = std::env::temp_dir().join(format!(
            "fielora-artifact-export-outside-{}",
            Uuid::now_v7()
        ));
        fs::create_dir_all(&outside).unwrap();
        let link = root.join("escape");
        create_directory_link(&link, &outside);
        assert_eq!(
            runtime.execute(
                "artifact.export",
                &document_args("escape/out.docx"),
                false,
                &CommandCancellation::default()
            ),
            Err(AgentError::WorkspaceEscape)
        );
        assert!(!outside.join("out.docx").exists());
        fs::remove_dir(&link).unwrap();
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    #[test]
    fn renderer_structural_and_output_bound_failures_leave_no_output() {
        let (root, runtime) = fixture_runtime();
        let cancellation = CommandCancellation::default();
        let renderer_error = export_with(
            &runtime,
            &document_args("renderer-error.docx"),
            &cancellation,
            |_| Err(AgentError::IoFailed),
            |_, _| {},
        );
        assert_eq!(renderer_error, Err(AgentError::IoFailed));
        let malformed = export_with(
            &runtime,
            &document_args("malformed.docx"),
            &cancellation,
            |_| {
                Ok(RenderedArtifact {
                    bytes: b"not OOXML".to_vec(),
                })
            },
            |_, _| {},
        );
        assert_eq!(malformed, Err(AgentError::IoFailed));
        let oversized = export_with(
            &runtime,
            &document_args("too-large.docx"),
            &cancellation,
            |_| {
                Ok(RenderedArtifact {
                    bytes: vec![0; MAX_OUTPUT_BYTES + 1],
                })
            },
            |_, _| {},
        );
        assert_eq!(oversized, Err(AgentError::FileTooLarge));
        assert!(!root.join("renderer-error.docx").exists());
        assert!(!root.join("malformed.docx").exists());
        assert!(!root.join("too-large.docx").exists());
        assert_no_temporary_files(&root);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cancellation_boundaries_and_atomic_race_leave_no_partial_export() {
        let (root, runtime) = fixture_runtime();
        let before = CommandCancellation::default();
        before.cancel();
        assert_eq!(
            runtime.execute(
                "artifact.export",
                &document_args("before.docx"),
                false,
                &before
            ),
            Err(AgentError::Cancelled)
        );

        let during = CommandCancellation::default();
        let during_hook = during.clone();
        let cancelled = export_with(
            &runtime,
            &document_args("during.docx"),
            &during,
            render,
            move |stage, _| {
                if stage == ExportStage::Rendered {
                    during_hook.cancel();
                }
            },
        );
        assert_eq!(cancelled, Err(AgentError::Cancelled));

        let raced = export_with(
            &runtime,
            &document_args("race.docx"),
            &CommandCancellation::default(),
            render,
            |stage, target| {
                if stage == ExportStage::BeforeAtomicWrite {
                    fs::write(target, b"racing writer").unwrap();
                }
            },
        );
        assert_eq!(raced, Err(AgentError::FileChanged));
        assert_eq!(fs::read(root.join("race.docx")).unwrap(), b"racing writer");
        assert!(!root.join("before.docx").exists());
        assert!(!root.join("during.docx").exists());
        assert_no_temporary_files(&root);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn interrupted_export_is_fail_closed_manual_recovery() {
        let (root, runtime) = fixture_runtime();
        let reconciliation = runtime
            .reconcile_unknown(
                "artifact.export",
                AgentToolEffect::WorkspaceWrite,
                &document_args("unknown.docx"),
            )
            .unwrap();
        assert_eq!(
            reconciliation.status,
            crate::ToolReconciliationStatus::ManualReview
        );
        assert!(!root.join("unknown.docx").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn saved_document_presentation_diagram_and_spreadsheet_exports_pin_exact_semantic_revisions() {
        let (root, runtime) = fixture_runtime();
        let cases = vec![
            (
                DurableArtifactType::Document,
                document_args("unused.docx")["content"].clone(),
                "saved-document.docx",
            ),
            (
                DurableArtifactType::Presentation,
                presentation_args("unused.pptx")["content"].clone(),
                "saved-presentation.pptx",
            ),
            (
                DurableArtifactType::Diagram,
                diagram_content("Execution 执行"),
                "saved-diagram.svg",
            ),
            (
                DurableArtifactType::Spreadsheet,
                spreadsheet_content("01.2500", "Literal summary"),
                "saved-spreadsheet.xlsx",
            ),
        ];
        for (artifact_type, content, output_path) in cases {
            let canonical = canonicalize_content(artifact_type, content).unwrap();
            let artifact_id = ArtifactId::new(Uuid::now_v7().to_string());
            let selected_revision = ArtifactRevisionId::new(Uuid::now_v7().to_string());
            let newer_current_revision = ArtifactRevisionId::new(Uuid::now_v7().to_string());
            let read = ArtifactReadView {
                artifact: ArtifactView {
                    artifact_id: artifact_id.clone(),
                    profile_id: ProfileId::new(Uuid::now_v7().to_string()),
                    artifact_type,
                    title: Some("Saved export".into()),
                    project_field_id: None,
                    // Deliberately point current elsewhere: the selected
                    // historical revision must remain the rendered authority.
                    current_revision_id: newer_current_revision,
                    created_from_conversation_id: None,
                    created_by_agent_run_id: None,
                    updated_by_device: DeviceId::new(Uuid::now_v7().to_string()),
                    created_at: 1,
                    updated_at: 2,
                    archived_at: None,
                },
                revision: ArtifactRevisionView {
                    revision_id: selected_revision.clone(),
                    artifact_id: artifact_id.clone(),
                    sequence: 1,
                    parent_revision_id: None,
                    mutation_kind: ArtifactMutationKind::Create,
                    content_schema_version: 1,
                    semantic_sha256: canonical.semantic_sha256.clone(),
                    content: canonical.content,
                    created_from_conversation_id: Some(ConversationId::new(
                        Uuid::now_v7().to_string(),
                    )),
                    created_by_agent_run_id: Some(AgentRunId::new(Uuid::now_v7().to_string())),
                    created_by_tool_call_id: ToolCallId::new(Uuid::now_v7().to_string()),
                    created_at: 1,
                },
            };
            let execution = export_saved(
                &runtime,
                &read,
                output_path,
                &CommandCancellation::default(),
            )
            .unwrap();
            assert_eq!(execution.receipt["artifact_id"], artifact_id.0);
            assert_eq!(
                execution.receipt["artifact_revision_id"],
                selected_revision.0
            );
            assert_eq!(execution.receipt["artifact_revision"], 1);
            assert_eq!(execution.receipt["artifact_persistence"], "DURABLE");
            assert_eq!(
                execution.receipt["artifact_semantic_sha256"],
                canonical.semantic_sha256
            );
            assert!(root.join(output_path).is_file());
            if artifact_type == DurableArtifactType::Diagram {
                assert_eq!(execution.receipt["renderer_id"], diagram::RENDERER_ID);
                assert_eq!(execution.receipt["output_format"], "SVG");
                assert_eq!(execution.receipt["static_svg_security"], "PASS");
                assert_eq!(execution.receipt["node_count"], 5);
                assert!(!execution.receipt.to_string().contains("Execution 执行"));
            }
            if artifact_type == DurableArtifactType::Spreadsheet {
                assert_eq!(execution.receipt["renderer_id"], spreadsheet::RENDERER_ID);
                assert_eq!(execution.receipt["output_format"], "XLSX");
                assert_eq!(execution.receipt["xlsx_static_security"], "PASS");
                assert_eq!(execution.receipt["formula_count"], 0);
                assert_eq!(execution.receipt["external_relationship_count"], 0);
                assert_eq!(execution.receipt["macro_part_count"], 0);
                assert_eq!(execution.receipt["calculation_authority"], "NONE");
                assert!(!execution.receipt.to_string().contains("Literal summary"));
            }
            assert_eq!(
                export_saved(
                    &runtime,
                    &read,
                    output_path,
                    &CommandCancellation::default(),
                ),
                Err(AgentError::FileChanged)
            );
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn durable_canonical_content_reuses_strict_renderer_admission() {
        let valid = canonicalize_content(
            DurableArtifactType::Document,
            document_args("unused.docx")["content"].clone(),
        )
        .unwrap();
        assert!(valid.canonical_json.len() <= MAX_DEFINITION_BYTES);
        assert_eq!(
            valid.semantic_sha256,
            sha256(valid.canonical_json.as_bytes())
        );
        assert!(matches!(valid.content, ArtifactContentV1::Document(_)));

        assert_eq!(
            canonicalize_content(
                DurableArtifactType::Document,
                json!({"blocks":[{"kind":"PARAGRAPH","text":"valid"}],"unknown":true}),
            ),
            Err(AgentError::ArtifactContentInvalid)
        );
        assert_eq!(
            canonicalize_content(
                DurableArtifactType::Document,
                json!({"blocks":[{"kind":"PARAGRAPH","text":"x".repeat(MAX_TEXT_ITEM_BYTES + 1)}]}),
            ),
            Err(AgentError::ArtifactContentInvalid)
        );
        assert_eq!(
            canonicalize_content(
                DurableArtifactType::Presentation,
                json!({"slides":[{"layout":"TITLE","title":"bad\0title","regions":[]}]}),
            ),
            Err(AgentError::ArtifactContentInvalid)
        );

        let diagram = diagram_content("Execution 执行");
        let first = canonicalize_content(DurableArtifactType::Diagram, diagram.clone()).unwrap();
        let mut reordered = diagram;
        reordered["nodes"].as_array_mut().unwrap().reverse();
        reordered["edges"].as_array_mut().unwrap().reverse();
        reordered["groups"].as_array_mut().unwrap().reverse();
        for group in reordered["groups"].as_array_mut().unwrap() {
            group["member_node_ids"].as_array_mut().unwrap().reverse();
        }
        let second = canonicalize_content(DurableArtifactType::Diagram, reordered).unwrap();
        assert_eq!(first.canonical_json, second.canonical_json);
        assert_eq!(first.semantic_sha256, second.semantic_sha256);
        assert_eq!(first.semantic_unit_count, 12);
        assert!(matches!(first.content, ArtifactContentV1::Diagram(_)));

        let mut invalid = diagram_content("Execution");
        invalid["edges"][0]["target_node_id"] = json!("missing");
        assert_eq!(
            canonicalize_content(DurableArtifactType::Diagram, invalid),
            Err(AgentError::ArtifactContentInvalid)
        );

        let first = canonicalize_content(
            DurableArtifactType::Spreadsheet,
            spreadsheet_content("01.2500", "Literal summary"),
        )
        .unwrap();
        let mut reordered = spreadsheet_content("1.25", "Literal summary");
        reordered["sheets"].as_array_mut().unwrap().reverse();
        for sheet in reordered["sheets"].as_array_mut().unwrap() {
            sheet["cells"].as_array_mut().unwrap().reverse();
        }
        let second = canonicalize_content(DurableArtifactType::Spreadsheet, reordered).unwrap();
        assert_eq!(first.canonical_json, second.canonical_json);
        assert_eq!(first.semantic_sha256, second.semantic_sha256);
        assert_eq!(first.semantic_unit_count, 8);
        assert!(matches!(first.content, ArtifactContentV1::Spreadsheet(_)));

        let mut formula = spreadsheet_content("1.25", "Literal summary");
        formula["sheets"][0]["cells"][0]["value"] = json!({"kind":"FORMULA","value":"SUM(A1:A2)"});
        assert_eq!(
            canonicalize_content(DurableArtifactType::Spreadsheet, formula),
            Err(AgentError::ArtifactContentInvalid)
        );

        assert!(create_input_schema().to_string().contains("diagram"));
        assert!(create_input_schema().to_string().contains("spreadsheet"));
        assert!(!legacy_input_schema().to_string().contains("diagram"));
        assert!(!legacy_input_schema().to_string().contains("spreadsheet"));
    }
}
