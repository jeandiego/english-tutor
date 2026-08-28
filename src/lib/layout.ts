// Shared with the SidebarProvider's --sidebar-width (see App.tsx) so the
// fixed title-bar chrome can track the sidebar's expanded width exactly.
export const SIDEBAR_WIDTH_PX = 196;

// Height of the fixed title-bar strip (TopBar). Kept in sync with the
// macOS traffic-light inset in src-tauri/tauri.conf.json — the dots are
// vertically centered on this same height, and AppSidebar/App.tsx pad their
// content down by this amount to clear the strip.
export const TITLEBAR_HEIGHT_PX = 40;

// Left inset (in px) for content that must clear the macOS traffic lights
// in the overlay title bar. Matches trafficLightPosition.x in
// tauri.conf.json plus the lights' cluster width and a small gap.
export const MAC_TRAFFIC_LIGHT_CLEARANCE_PX = 72;
