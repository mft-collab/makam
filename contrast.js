function luminance(r, g, b) {
  var a = [r, g, b].map(function (v) {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
}

function contrast(rgb1, rgb2) {
  var lum1 = luminance(rgb1[0], rgb1[1], rgb1[2]);
  var lum2 = luminance(rgb2[0], rgb2[1], rgb2[2]);
  var brightest = Math.max(lum1, lum2);
  var darkest = Math.min(lum1, lum2);
  return (brightest + 0.05) / (darkest + 0.05);
}

const colors = {
  bgBase: [18, 18, 16], // #121210
  bgSurface: [30, 30, 28], // rgba(30, 30, 28, 1) blended roughly
  bgElevated: [26, 26, 24], // #1A1A18
  textMain: [245, 243, 239], // #F5F3EF
  textMuted: [156, 163, 175], // #9CA3AF
  textLight: [65, 65, 65], // rgba(255,255,255, 0.2) on #121210
  executiveGold: [197, 160, 89], // #C5A059
  white: [255, 255, 255],
  executiveBlue: [22, 21, 19] // #161513
};

console.log("Dark Theme WCAG Contrast Ratios:");
console.log("--------------------------------");
console.log("textMain (#F5F3EF) on bgBase (#121210):", contrast(colors.textMain, colors.bgBase).toFixed(2));
console.log("textMuted (#9CA3AF) on bgBase (#121210):", contrast(colors.textMuted, colors.bgBase).toFixed(2));
console.log("textLight (20% white) on bgBase (#121210):", contrast(colors.textLight, colors.bgBase).toFixed(2));
console.log("textMain on bgSurface (#1e1e1c):", contrast(colors.textMain, colors.bgSurface).toFixed(2));
console.log("textMain on bgElevated (#1A1A18):", contrast(colors.textMain, colors.bgElevated).toFixed(2));
console.log("---");
console.log("Primary Button (White text on Executive Gold bg):", contrast(colors.white, colors.executiveGold).toFixed(2));
console.log("Executive Blue (#161513) text on bgBase (#121210):", contrast(colors.executiveBlue, colors.bgBase).toFixed(2));
