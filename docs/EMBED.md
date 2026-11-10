# Putting a film in an article or an existing site

`release/embed/wins-motion.js` (rebuilt as `dist/embed/wins-motion.js`) is the whole
thing in one file: the ten films, the timeline, the captions, the fonts. It needs no
build step, no framework and no other files. Open `release/embed/demo.html` to see it
running inside a stand-in article.

## The two-line version

Put this where the stage should appear:

```html
<div data-wins-motion data-project="victus-haze"></div>
<script src="/path/to/wins-motion.js"></script>
```

That shows one film, with its headline, timeline, captions and any button it needs.

## Following a page that already switches between items

If the page has its own list, tabs or carousel, point the stage at the element that
shows the current item's name:

```html
<div data-wins-motion data-follow="#win-title"></div>
<script src="/path/to/wins-motion.js"></script>
```

`data-follow` is a CSS selector. Whenever the page's own script changes that
element's text, the stage plays the matching film. Nothing else on the page has to
change, and the page's script does not need to know the widget exists.

Names are matched loosely: `Victus Haze`, `VICTUS HAZE` and `victus-haze` all work, as
do `Varda W-5` and `varda-w5`.

## Options

Set these as attributes on the `<div>`:

| attribute | effect |
| --- | --- |
| `data-project="quarterhorse"` | which film to show first (default: the followed element, else the first win) |
| `data-follow="#selector"` | follow an element's text (or its `data-project` attribute) |
| `data-hash` | follow the URL fragment, e.g. `#blackbeard` |
| `data-heading="false"` | hide the headline and prompt above the stage |
| `data-captions="false"` | hide the caption line under the timeline |
| `data-fonts="false"` | do not load the bundled fonts |

The stage has its own play button, timeline, speed control and replay.

## Driving it from code

```html
<div id="demo"></div>
<script src="/path/to/wins-motion.js"></script>
<script>
  const demo = WinsMotion.mount('#demo', { project: 'fury' });

  demo.show('leonidas');        // id, name, or 1-based number. Showing the current one replays it.

  demo.pause(); demo.play(); demo.replay(); demo.seek(9);
  demo.state;                   // { project, time, duration, playing, ended }
  WinsMotion.projects;          // [{ id, name, category }, ...]
</script>
```

The host element fires `wins-motion:change` (with `event.detail.project`) whenever the
film changes, in case the page wants to react.

In React or similar, call `WinsMotion.mount(ref.current, …)` once in an effect and
`demo.show(id)` when the selected item changes.

## Fitting in

The widget renders inside a shadow root, so the site's CSS cannot break it and its CSS
cannot leak out. It takes the full width of its container and keeps a 1280:520 stage.
It brings its own dark ground, so it reads the same on a light page.

To match a site's palette, set these custom properties on the host element. Use
six-digit hex values:

```css
[data-wins-motion] {
  --stage: #050505;   /* stage background */
  --mark: #d8d8d4;    /* lines, dots and bars */
  --live: #dff140;    /* the accent */
  --ink: #ffffff;     /* text */
  --line-2: #2f3234;  /* rules and the stage border */
}
```

The full list is at the top of `src/styles/base.css`.

## Notes

- One stage per page. Mounting a second time returns the first.
- The script makes no network requests and sets no cookies. It adds one global,
  `WinsMotion`.
- Film ids: `fury`, `leonidas`, `ward-250`, `talon-a2`, `varda-w5`, `lucas`,
  `quarterhorse`, `marauder`, `victus-haze`, `blackbeard`.
- The embed does not show the source line; credit the sources in the article. They are
  listed for every film in `docs/SOURCES.md`.
- Rebuild with `npm run build` after changing anything in `src/`.
- The script is about 185 KB (about 80 KB compressed) and holds all ten films.

## The alternative: an iframe

If adding a script is not possible, the standalone page can be framed and linked to a
film by its fragment:

```html
<iframe src="/path/to/ten-wins-in-motion.html#victus-haze" title="Victus Haze, animated"
        style="width:100%;aspect-ratio:16/10;border:0"></iframe>
```

That shows the whole page, header included, so the script version is the better fit
inside an article.
