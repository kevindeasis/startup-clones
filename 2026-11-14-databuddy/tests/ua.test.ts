import { describe, expect, it } from "vitest";
import { parseUa } from "../src/lib/ua";

describe("parseUa", () => {
  it.each([
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36", { browser: "Chrome", os: "Windows", device: "desktop" }],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1", { browser: "Safari", os: "iOS", device: "mobile" }],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0", { browser: "Firefox", os: "Linux", device: "desktop" }],
    ["Mozilla/5.0 (Linux; Android 14; Pixel Tablet) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0", { browser: "Edge", os: "Android", device: "tablet" }],
  ])("parses %s", (ua, expected) => {
    expect(parseUa(ua)).toEqual(expected);
  });
});
