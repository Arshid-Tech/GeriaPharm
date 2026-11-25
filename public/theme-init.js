// Apply stored theme before first paint to avoid a flash of the wrong scheme.
(function () {
  try {
    var t = localStorage.getItem("gp-theme");
    if (t !== "light" && t !== "dark" && t !== "system") t = "system";
    var dark =
      t === "dark" ||
      (t === "system" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (dark) document.documentElement.classList.add("dark");
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = dark ? "#090d16" : "#f8fafc";
  } catch (e) {}
})();
