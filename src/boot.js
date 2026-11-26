// boot.js – Einstieg: normale App oder Splitscreen (zwei Notizen nebeneinander, siehe split.js)
// Im Splitscreen ist die Seite nur ein Rahmen mit zwei Fenstern (iframes), in denen
// jeweils die ganze App läuft (?pane=L und ?pane=R).
if (new URLSearchParams(location.search).has('split')) import('./split.js');
else import('./main.js');
