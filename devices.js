// The list of phones in the dropdown.
//
// width / height are CSS pixels (the "viewport"): the size a website sees,
// not the raw screen resolution. That is the number that decides how a
// website lays itself out.
//
// cutout: the camera shape at the top of the screen
//   "island" = iPhone Dynamic Island pill
//   "notch"  = older iPhone notch
//   "hole"   = Android punch-hole camera
//
// top10: true when the phone was in Counterpoint's global top 10
// best-sellers for Q2 2026 (the latest list before September 2026).
window.PHONE_DEVICES = [
  { brand: "Apple", name: "iPhone 17 Pro Max", width: 440, height: 956, os: "ios", cutout: "island", radius: 62, top10: true },
  { brand: "Apple", name: "iPhone 17 Pro", width: 402, height: 874, os: "ios", cutout: "island", radius: 58, top10: true },
  { brand: "Apple", name: "iPhone 17", width: 402, height: 874, os: "ios", cutout: "island", radius: 58, top10: true },
  { brand: "Apple", name: "iPhone Air", width: 420, height: 912, os: "ios", cutout: "island", radius: 60 },
  { brand: "Apple", name: "iPhone 17e", width: 390, height: 844, os: "ios", cutout: "notch", radius: 50, top10: true },
  { brand: "Apple", name: "iPhone 16 Pro Max", width: 440, height: 956, os: "ios", cutout: "island", radius: 62 },
  { brand: "Apple", name: "iPhone 16", width: 393, height: 852, os: "ios", cutout: "island", radius: 56, top10: true },

  { brand: "Samsung", name: "Galaxy S26 Ultra", width: 412, height: 891, os: "android", cutout: "hole", radius: 28, top10: true },
  { brand: "Samsung", name: "Galaxy S26", width: 360, height: 780, os: "android", cutout: "hole", radius: 44, top10: true },
  { brand: "Samsung", name: "Galaxy A17", width: 412, height: 892, os: "android", cutout: "hole", radius: 36, top10: true },
  // Estimated from its 720 x 1600 screen; no published viewport figure yet.
  { brand: "Samsung", name: "Galaxy A07", width: 412, height: 915, os: "android", cutout: "hole", radius: 34, top10: true },

  { brand: "Google", name: "Pixel 10", width: 412, height: 924, os: "android", cutout: "hole", radius: 48 },
  { brand: "Google", name: "Pixel 10 Pro XL", width: 432, height: 960, os: "android", cutout: "hole", radius: 50 },
];
