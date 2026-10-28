(() => {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const track = document.querySelector(".track");
  const reel = document.querySelector(".reel");
  const intro = document.querySelector(".intro");

  // Scroll timeline: the title card fades out over the first INTRO_VH of scroll;
  // the rest (q, rescaled to 0..1) is shared by the frames. Each .frame declares
  // its own window in the HTML: data-draw-from/to (it draws itself) and
  // data-advance-from/to (the reel moves on to the next frame).
  const INTRO_VH = 0.4;
  const GAP_VH = 10;
  let introEnd = 0.04;

  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  // Film grain tile, generated once
  const grainSvg =
    "<svg xmlns='http://www.w3.org/2000/svg' width='256' height='256'>" +
    "<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/>" +
    "<feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1.4 0 0 0 -.5'/></filter>" +
    "<rect width='100%' height='100%' filter='url(#n)'/></svg>";
  document.documentElement.style.setProperty(
    "--grain",
    `url("data:image/svg+xml,${encodeURIComponent(grainSvg)}")`
  );

  // A frame's own drawing progress (0..1) for the global progress q
  const frames = [...document.querySelectorAll(".frame")].map((el) => ({
    el,
    from: +(el.dataset.drawFrom ?? 0),
    to: +(el.dataset.drawTo ?? 0),
    advFrom: el.dataset.advanceFrom === undefined ? null : +el.dataset.advanceFrom,
    advTo: el.dataset.advanceTo === undefined ? null : +el.dataset.advanceTo,
  }));
  const frameOf = (el) => frames.find((f) => f.el === el.closest(".frame"));
  const progress = (f, q) => (f && f.to > f.from ? clamp((q - f.from) / (f.to - f.from)) : 0);

  // Stroke-draw groups. Without JS everything stays fully drawn.
  const groups = [...document.querySelectorAll("[data-from]")].map((el) => {
    const fade = el.hasAttribute("data-fade");
    const parts = fade ? [] : [...el.querySelectorAll("path, circle, ellipse, line")];
    parts.forEach((p) => {
      p.setAttribute("pathLength", "1");
      p.style.strokeDasharray = "1 1";
    });
    return { el, fade, parts, frame: frameOf(el), from: +el.dataset.from, to: +el.dataset.to };
  });

  const draw = (q) => {
    for (const g of groups) {
      const d = progress(g.frame, q);
      const local = clamp((d - g.from) / (g.to - g.from));
      if (g.fade) {
        g.el.style.opacity = local;
        continue;
      }
      const n = g.parts.length;
      g.parts.forEach((p, i) => {
        const t = clamp(local * n - i);
        p.style.strokeDashoffset = 1 - t;
        p.style.opacity = t > 0 ? 1 : 0;
      });
    }
  };

  // Subtitles: fade in/out over a window of the draw timeline
  const FADE = 0.04;
  const subs = [...document.querySelectorAll("[data-show-from]")].map((el) => ({
    el,
    frame: frameOf(el),
    from: +el.dataset.showFrom,
    to: +el.dataset.showTo,
  }));

  const showSubs = (q) => {
    for (const s of subs) {
      const d = progress(s.frame, q);
      s.el.style.opacity = clamp((d - s.from) / FADE) * clamp((s.to - d) / FADE);
    }
  };

  // Chalkboard: words scattered over the board are "written" left to right, one after
  // another, by a hand that follows the chalk. Position, size and tilt come from the HTML.
  // A word with data-center is centred on that x; a [data-chalk-line] underlines the item before it.
  const NS = "http://www.w3.org/2000/svg";
  const OFFSCREEN = { x: 1750, y: 1000 };
  const lerp = (a, b, t) => a + (b - a) * t;

  const boards = [...document.querySelectorAll("svg[data-board]")].map((svg) => {
    const frame = frameOf(svg);
    const els = [...svg.querySelectorAll("[data-word], [data-chalk-line]")];
    const hand = svg.querySelector(".chalk-hand");
    const defs = svg.querySelector("defs");
    let items = [];
    let segs = [];
    let total = 1;

    // a point given in an item's own (tilted) coordinates, mapped onto the board
    const onBoard = (it, lx, ly) => {
      const a = (it.rot * Math.PI) / 180;
      const dx = lx - it.x;
      const dy = ly - it.y;
      return { x: it.x + dx * Math.cos(a) - dy * Math.sin(a), y: it.y + dx * Math.sin(a) + dy * Math.cos(a) };
    };

    const layout = () => {
      items = [];
      els.forEach((el) => {
        if (el.hasAttribute("data-chalk-line")) {
          const prev = items[items.length - 1];
          const x1 = prev.x - 8;
          const x2 = prev.x + prev.w + 8;
          const y = prev.y + prev.size * 0.62;
          el.setAttribute("d", `M${x1} ${y} Q${(x1 + x2) / 2} ${y - 8} ${x2} ${y + 3}`);
          items.push({ el, x: x1, y, rot: 0, size: 60, w: x2 - x1, tipY: y, boxY: y - 30, boxH: 60 });
          return;
        }
        const size = +(el.dataset.size || 84);
        el.style.fontSize = `${size}px`;
        const w = el.getComputedTextLength();
        const x = el.dataset.center ? +el.dataset.center - w / 2 : +el.dataset.x;
        const y = +el.dataset.y;
        const rot = +(el.dataset.rot || 0);
        el.setAttribute("x", x);
        el.setAttribute("y", y);
        el.setAttribute("transform", `rotate(${rot} ${x} ${y})`);
        items.push({ el, x, y, rot, size, w, tipY: y - size * 0.3, boxY: y - size, boxH: size * 1.4 });
      });

      items.forEach((it, i) => {
        const id = `board-clip-${i}`;
        let clip = svg.querySelector(`#${id}`);
        if (!clip) {
          clip = document.createElementNS(NS, "clipPath");
          clip.id = id;
          clip.appendChild(document.createElementNS(NS, "rect"));
          defs.appendChild(clip);
          it.el.setAttribute("clip-path", `url(#${id})`);
        }
        it.rect = clip.firstChild;
        it.rect.setAttribute("x", it.x - 10);
        it.rect.setAttribute("y", it.boxY);
        it.rect.setAttribute("height", it.boxH);
        it.rect.setAttribute("width", 0);
      });

      // The hand's journey: in from the corner, write each item, back out
      segs = [];
      let at = OFFSCREEN;
      items.forEach((it) => {
        const start = onBoard(it, it.x, it.tipY);
        segs.push({ type: "travel", from: at, to: start, cost: at === OFFSCREEN ? 220 : 160 });
        segs.push({ type: "write", item: it, cost: it.w });
        at = onBoard(it, it.x + it.w, it.tipY);
      });
      segs.push({ type: "travel", from: at, to: OFFSCREEN, cost: 220 });
      total = segs.reduce((sum, sg) => sum + sg.cost, 0);
    };

    const update = (d) => {
      if (!items.length) return;
      let pos = clamp(d) * total;
      items.forEach((it) => it.rect.setAttribute("width", 0));
      let tip = OFFSCREEN;
      for (const sg of segs) {
        if (pos <= 0) break;
        const t = clamp(pos / sg.cost);
        if (sg.type === "travel") {
          const e = ease(t);
          tip = { x: lerp(sg.from.x, sg.to.x, e), y: lerp(sg.from.y, sg.to.y, e) };
        } else {
          const it = sg.item;
          it.rect.setAttribute("width", t * (it.w + 24));
          tip = onBoard(it, it.x + t * it.w, it.tipY + Math.sin((t * it.w) / 9) * 5);
        }
        pos -= sg.cost;
      }
      if (hand) hand.setAttribute("transform", `translate(${tip.x} ${tip.y})`);
    };

    layout();
    update(0);
    return { frame, layout, update };
  });

  // The press: a typewriter "prints" newspapers that fly up, one after another, into a row on a rope
  const presses = [...document.querySelectorAll("svg[data-press]")].map((svg) => {
    const frame = frameOf(svg);
    const flyers = [...svg.querySelectorAll("[data-flyer]")].map((g) => ({
      g,
      tx: +g.dataset.tx,
      ty: +g.dataset.ty,
      rot: +(g.dataset.rot || 0),
    }));
    const typewriter = svg.querySelector(".typewriter");
    const SLOT = { x: 800, y: 500 };
    const START = 0.35;
    const END = 0.98;
    const span = (END - START) / (flyers.length - 1 + 1.6);

    const update = (d) => {
      let flying = false;
      flyers.forEach((f, i) => {
        const t = clamp((d - (START + i * span)) / (span * 1.6));
        if (t <= 0) {
          f.g.style.opacity = 0;
          return;
        }
        f.g.style.opacity = 1;
        if (t < 1) flying = true;
        const e = ease(t);
        const side = f.tx < SLOT.x ? -1 : 1;
        const x = lerp(SLOT.x, f.tx, e) + Math.sin(e * Math.PI) * 50 * side;
        const y = lerp(SLOT.y, f.ty, e) - Math.sin(e * Math.PI) * 90;
        const scale = lerp(0.3, 1, e);
        const rot = f.rot + (1 - e) * (i % 2 ? 50 : -50);
        f.g.setAttribute("transform", `translate(${x} ${y}) rotate(${rot}) scale(${scale})`);
      });
      // the typewriter shakes a little while it is printing
      if (typewriter) {
        const jitter = flying ? (Math.floor(d * 300) % 2 ? 2 : -2) : 0;
        typewriter.setAttribute("transform", `translate(0 ${jitter})`);
      }
    };

    update(0);
    return { frame, update };
  });

  // The seesaw: a horse falls onto one end of a plank, speeding up; the other end
  // throws the infantrymen into the air. Geometry mirrors the HTML (pivot, plank thickness).
  const seesaws = [...document.querySelectorAll("svg[data-seesaw]")].map((svg) => {
    const frame = frameOf(svg);
    const PIVOT = { x: 800, y: 700 };
    const THICK = 22;
    const TILT = 11;
    const HORSE_U = 300;
    const FALL_FROM = 0.22;
    const HIT = 0.55;
    const plank = svg.querySelector("[data-plank]");
    const horse = svg.querySelector("[data-horse]");
    const speed = svg.querySelector("[data-speed]");
    const dust = svg.querySelector("[data-dust]");
    const soldiers = [...svg.querySelectorAll("[data-soldier]")].map((el, i) => ({
      el,
      u: +el.dataset.u,
      tall: +el.dataset.tall,
      start: HIT + i * 0.012,
      phase: i * 0.07,
    }));

    // a point on the plank's top face, in screen coordinates
    const onPlank = (u, deg) => {
      const a = (deg * Math.PI) / 180;
      return {
        x: PIVOT.x + u * Math.cos(a) + THICK * Math.sin(a),
        y: PIVOT.y + u * Math.sin(a) - THICK * Math.cos(a),
      };
    };

    const update = (d) => {
      // plank: right end up until the hit, then it slams down
      const swing = 1 - Math.pow(1 - clamp((d - HIT) / 0.1), 3);
      const deg = lerp(-TILT, TILT, swing);
      plank.setAttribute("transform", `translate(${PIVOT.x} ${PIVOT.y}) rotate(${deg})`);

      // horse: quadratic fall (accelerating), then it rides the plank
      const rest = onPlank(HORSE_U, -TILT);
      if (d < FALL_FROM) {
        horse.style.opacity = 0;
      } else {
        horse.style.opacity = 1;
        const t = clamp((d - FALL_FROM) / (HIT - FALL_FROM));
        let p = { x: rest.x, y: lerp(-40, rest.y, t * t) };
        let rot = lerp(-22, -TILT, t);
        if (d >= HIT) {
          p = onPlank(HORSE_U, deg);
          rot = deg;
        }
        horse.setAttribute("transform", `translate(${p.x} ${p.y}) rotate(${rot})`);
        if (speed) {
          speed.style.opacity = d < HIT ? clamp(t * 2.5) : 0;
          speed.setAttribute("transform", `rotate(${-rot})`); // keep the lines vertical
        }
      }

      // dust cloud at the impact point
      if (dust) {
        const t = clamp((d - HIT) / 0.2);
        dust.style.opacity = t > 0 && t < 1 ? 1 - t : 0;
        dust.setAttribute("transform", `translate(${rest.x} ${rest.y}) scale(${0.4 + 0.9 * t})`);
      }

      // infantrymen: stand on the plank, get flung up, land, then cheer with two hops
      soldiers.forEach((s) => {
        const p = onPlank(s.u, deg);
        const fly = clamp((d - s.start) / 0.26);
        let lift = s.tall * Math.sin(Math.PI * fly);
        const w = clamp((d - 0.86 - s.phase) / (0.12 - s.phase));
        lift += 38 * Math.abs(Math.sin(w * Math.PI * 2));
        s.el.style.opacity = clamp((d - 0.1) / 0.06);
        s.el.setAttribute("transform", `translate(${p.x} ${p.y - lift}) scale(.82)`);
      });
    };

    update(0);
    return { frame, update };
  });

  // Quiz: pick an answer. Right: confetti. Wrong: the screen flashes red and the right answer lights up.
  const flash = document.createElement("div");
  flash.className = "flash";
  flash.setAttribute("aria-hidden", "true");
  document.body.append(flash);

  const confetti = () => {
    if (reduced) return;
    const cv = document.createElement("canvas");
    cv.className = "confetti";
    cv.width = innerWidth;
    cv.height = innerHeight;
    document.body.append(cv);
    const ctx = cv.getContext("2d");
    const colors = ["#c23a2e", "#ffd84a", "#2f9e44", "#2b6fd6", "#f7f1de", "#e07bb4"];
    const bits = Array.from({ length: 220 }, () => ({
      x: Math.random() * cv.width,
      y: -20 - Math.random() * cv.height * 0.6,
      vx: (Math.random() - 0.5) * 3,
      vy: 2 + Math.random() * 4,
      w: 6 + Math.random() * 8,
      h: 10 + Math.random() * 8,
      a: Math.random() * Math.PI,
      va: (Math.random() - 0.5) * 0.3,
      c: colors[Math.floor(Math.random() * colors.length)],
    }));
    const t0 = performance.now();
    const tick = (now) => {
      const t = now - t0;
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.globalAlpha = clamp((5000 - t) / 1200);
      for (const b of bits) {
        b.x += b.vx + Math.sin(b.a) * 0.8;
        b.y += b.vy;
        b.a += b.va;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.a);
        ctx.fillStyle = b.c;
        ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
        ctx.restore();
      }
      if (t < 5000) requestAnimationFrame(tick);
      else cv.remove();
    };
    requestAnimationFrame(tick);
  };

  document.querySelectorAll("svg[data-quiz]").forEach((svg) => {
    const opts = [...svg.querySelectorAll("[data-opt]")];
    const results = [...svg.querySelectorAll("[data-result]")];
    const pick = (opt) => {
      // ignore clicks while the answers are still being drawn
      if (+getComputedStyle(opt.closest("[data-fade]")).opacity < 0.9) return;
      const ok = opt.hasAttribute("data-correct");
      opts.forEach((o) => o.classList.remove("is-right", "is-wrong", "is-reveal"));
      results.forEach((r) => (r.style.opacity = r.dataset.result === (ok ? "ok" : "bad") ? 1 : 0));
      if (ok) {
        opt.classList.add("is-right");
        confetti();
      } else {
        opt.classList.add("is-wrong");
        opts.find((o) => o.hasAttribute("data-correct")).classList.add("is-reveal");
        flash.classList.remove("on");
        void flash.offsetWidth;
        flash.classList.add("on");
      }
    };
    opts.forEach((o) => {
      o.addEventListener("click", () => pick(o));
      o.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          pick(o);
        }
      });
    });
  });

  const render = (p) => {
    const q = clamp((p - introEnd) / (1 - introEnd));
    draw(q);
    showSubs(q);
    boards.forEach((b) => b.update(progress(b.frame, q)));
    presses.forEach((pr) => pr.update(progress(pr.frame, q)));
    seesaws.forEach((s) => s.update(progress(s.frame, q)));

    // Each finished frame pushes the reel up by one frame (+ the dark gap between frames)
    let moved = 0;
    let moving = false;
    for (const f of frames) {
      if (f.advFrom === null) continue;
      const t = clamp((q - f.advFrom) / (f.advTo - f.advFrom));
      moved += ease(t);
      if (t > 0 && t < 1) moving = true;
    }
    const shake = !reduced && moving ? (Math.random() - 0.5) * 8 : 0;
    reel.style.transform = `translate3d(0, calc(${-moved * (100 + GAP_VH)}vh + ${shake}px), 0)`;

    if (intro) {
      const o = 1 - clamp(p / introEnd);
      intro.style.opacity = o;
      intro.style.visibility = o > 0 ? "visible" : "hidden";
    }
  };

  // UA / EN switch: Ukrainian is the text in the HTML, English lives in data-en
  const translatable = [...document.querySelectorAll("[data-en]")];
  translatable.forEach((el) => (el.dataset.uk = el.textContent.trim()));
  const svgs = [...document.querySelectorAll("svg[data-en-label]")];
  svgs.forEach((svg) => (svg.dataset.ukLabel = svg.getAttribute("aria-label")));
  const langButtons = [...document.querySelectorAll("[data-lang]")];

  const setLang = (lang) => {
    const en = lang === "en";
    document.documentElement.lang = en ? "en" : "uk";
    translatable.forEach((el) => {
      el.textContent = en ? el.dataset.en : el.dataset.uk;
    });
    svgs.forEach((svg) =>
      svg.setAttribute("aria-label", en ? svg.dataset.enLabel : svg.dataset.ukLabel)
    );
    langButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === lang)));
    try { localStorage.setItem("lang", lang); } catch {}
  };

  langButtons.forEach((b) =>
    b.addEventListener("click", () => {
      setLang(b.dataset.lang);
      boards.forEach((board) => board.layout()); // the board title changes width with the language
      render(current);
    })
  );

  let saved = null;
  try { saved = localStorage.getItem("lang"); } catch {}
  const browserIsUk = (navigator.language || "").toLowerCase().startsWith("uk");
  setLang(saved || (browserIsUk ? "uk" : "en"));

  // Smoothed scroll -> progress
  let current = 0;
  let target = 0;
  let raf = 0;

  const tick = () => {
    current += (target - current) * (reduced ? 1 : 0.1);
    if (Math.abs(target - current) < 0.0004) current = target;
    render(current);
    raf = current === target ? 0 : requestAnimationFrame(tick);
  };

  const onScroll = () => {
    const max = track.offsetHeight - innerHeight;
    introEnd = clamp((INTRO_VH * innerHeight) / max, 0.001, 0.5);
    target = clamp((scrollY - track.offsetTop) / max);
    if (!raf) raf = requestAnimationFrame(tick);
  };

  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onScroll);
  onScroll();
  render(current);

  // Title card fades in once on load; leaving is driven by scroll (see render)
  if (intro) {
    // Wait for the font so the title does not swap while it fades in
    const fontsReady = document.fonts ? document.fonts.ready : Promise.resolve();
    Promise.race([fontsReady, new Promise((r) => setTimeout(r, 1200))]).then(() =>
      intro.classList.add("is-playing")
    );
  }

  if (document.fonts) {
    document.fonts.ready.then(() => {
      boards.forEach((b) => b.layout());
      render(current);
    });
  }

  // Scratches and dust on the "film"
  if (!reduced) {
    const spawn = (cls, style, ttl) => {
      const el = document.createElement("div");
      el.className = cls;
      Object.assign(el.style, style);
      document.body.appendChild(el);
      setTimeout(() => el.remove(), ttl);
    };

    const scratch = () => {
      const h = 30 + Math.random() * 50;
      spawn("scratch", {
        left: `${Math.random() * 100}vw`,
        top: `${Math.random() * (100 - h)}vh`,
        height: `${h}vh`,
      }, 90 + Math.random() * 90);
      setTimeout(scratch, 700 + Math.random() * 2200);
    };

    const dust = () => {
      const s = 2 + Math.random() * 4;
      spawn("dust", {
        left: `${Math.random() * 100}vw`,
        top: `${Math.random() * 100}vh`,
        width: `${s}px`,
        height: `${s}px`,
      }, 80 + Math.random() * 120);
      setTimeout(dust, 150 + Math.random() * 700);
    };

    scratch();
    dust();
  }
})();
