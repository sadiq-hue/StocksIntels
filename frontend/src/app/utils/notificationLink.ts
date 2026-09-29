// Notification links come in two flavours: internal app routes (signal
// notifications -> /app/stock/...) and external article URLs (news
// notifications -> the publisher's site). Navigating to an absolute https URL
// with the router treats it as an app route and renders the 404 page, so
// external links are opened in a new tab instead.
export function isExternalLink(link?: string | null): boolean {
  return typeof link === 'string' && /^https?:\/\//i.test(link);
}

export function openNotificationLink(
  link: string | null | undefined,
  navigate: (to: string) => void,
) {
  if (!link) return;
  if (isExternalLink(link)) {
    window.open(link, "_blank", "noopener,noreferrer");
    return;
  }
  navigate(link);
}
