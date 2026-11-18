// Runs before first paint: autostart / replay links boot straight into the race without the site scroll
if (/[?&](autostart|replay)=(1|true)\b/i.test(window.location.search)) {
  document.documentElement.classList.add('autostart-boot');
} else {
  document.documentElement.classList.add('site-scroll');
}
