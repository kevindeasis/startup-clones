export type ParsedUa = {
  browser: "Chrome" | "Safari" | "Firefox" | "Edge" | "Other";
  os: "Windows" | "macOS" | "iOS" | "Android" | "Linux" | "Other";
  device: "desktop" | "mobile" | "tablet";
};

export function parseUa(ua: string): ParsedUa {
  let browser: ParsedUa["browser"] = "Other";
  if (/Edg(e|A|iOS)?\//.test(ua)) browser = "Edge";
  else if (/Firefox\/|FxiOS\//.test(ua)) browser = "Firefox";
  else if (/Chrome\/|CriOS\//.test(ua)) browser = "Chrome";
  else if (/Safari\//.test(ua)) browser = "Safari";

  let os: ParsedUa["os"] = "Other";
  if (/iPhone|iPad|iPod/.test(ua)) os = "iOS";
  else if (/Android/.test(ua)) os = "Android";
  else if (/Windows/.test(ua)) os = "Windows";
  else if (/Macintosh|Mac OS X/.test(ua)) os = "macOS";
  else if (/Linux|X11/.test(ua)) os = "Linux";

  let device: ParsedUa["device"] = "desktop";
  if (/iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))) device = "tablet";
  else if (/Mobile|iPhone|iPod|Android/.test(ua)) device = "mobile";

  return { browser, os, device };
}
