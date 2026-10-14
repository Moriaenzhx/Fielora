import { useState } from 'react';
import type { ActivityApplicationTarget } from './agent-activity-projection';
import { AppIcon } from './ui';

export function ActivityApplicationIdentity({ target, iconDataUrl, onPreview, detail, previewToolId }: {
  target: ActivityApplicationTarget;
  iconDataUrl?: string;
  onPreview?: () => void;
  detail?: string;
  previewToolId?: string;
}) {
  const [failedImage, setFailedImage] = useState('');
  // Icons are local host output. Never load an app-supplied URL in this surface.
  const icon = iconDataUrl?.startsWith('data:image/png;base64,') && iconDataUrl.length <= 128 * 1024 && failedImage !== iconDataUrl ? iconDataUrl : null;
  const title = [target.name, detail, onPreview && '查看当前应用窗口'].filter(Boolean).join(' · ');
  const content = <>
    {icon ? <img src={icon} alt="" onError={() => setFailedImage(icon)}/> : <AppIcon name="application"/>}
    <span>{target.name}</span>
  </>;
  return onPreview
    ? <button type="button" className="activity-application-identity" data-testid={`agent-application-preview-${previewToolId}`} data-application-id={target.appId || target.bundleId} title={title} aria-label={`${target.name}：查看当前应用窗口`} onClick={onPreview}>{content}</button>
    : <span className="activity-application-identity" data-testid="activity-application" data-application-id={target.appId || target.bundleId} title={title}>{content}</span>;
}
