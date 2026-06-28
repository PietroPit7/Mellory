import { Platform, useWindowDimensions } from "react-native";

export const DESKTOP_WEB_BREAKPOINT = 1024;
export const WIDE_WEB_BREAKPOINT = 1360;
export const DESKTOP_TAB_RAIL_WIDTH = 112;

export function useResponsiveLayout() {
  const { width, height } = useWindowDimensions();
  const isWeb = Platform.OS === "web";
  const isDesktopWeb = isWeb && width >= DESKTOP_WEB_BREAKPOINT;
  const isWideWeb = isWeb && width >= WIDE_WEB_BREAKPOINT;

  return {
    width,
    height,
    isWeb,
    isDesktopWeb,
    isWideWeb,
    desktopGutter: isWideWeb ? 56 : 36,
    desktopRailOffset: isDesktopWeb ? DESKTOP_TAB_RAIL_WIDTH : 0,
    contentMaxWidth: isDesktopWeb ? 1180 : 560,
  };
}
