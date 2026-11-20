#!/usr/bin/env python3
"""만나방 — 손님 모드 동적 식별 워터마크 검증.

확인 항목
  (1) UA 별 기기·브라우저 판별 (iPhone/Android/Mac/PC × 카톡/인스타/네이버/삼성인터넷/웨일/Edge/Chrome/Safari)
  (2) 문구 포맷 「만나방 · YYYY.MM.DD HH:MM · {기기} {브라우저} · #매물번호」 + 열람 시각이 실제 현재 시각
  (3) 상세를 다시 열 때마다 시각을 새로 찍는지 (시계를 고정해 확인)
  (4) SVG 타일이 기울인 글자 외곽보다 커서 글자가 타일 경계에서 잘리지 않는지
      + 타일 세로 높이(줄 간격)가 상세 갤러리 안에 3~4줄을 만드는지(2026-11-20 촘촘히 조정)
  (5) 상세 갤러리(#detailWm)·라이트박스(#lightboxWm) 둘 다 적용, 주선자 모드에서는 미노출
  (6) 특수문자 이스케이프 · 콘솔 에러 0

호출: python3 verify-dynwm.py local|deploy
"""
import sys, os, re, base64, functools, http.server, threading
from io import BytesIO
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.abspath(__file__))
MODE = sys.argv[1] if len(sys.argv) > 1 else "local"
PORT = 8798
CHROME = "/workspace/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell"
SHOT = "/workspace/downloads/만나방_식별워터마크_촘촘_20261120.png"

results = []


def serve():
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    h.log_message = lambda *a, **k: None
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), h)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def check(name, cond, extra=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + (f"  [{extra}]" if extra else ""))


def placeholder(c1, c2):
    img = Image.new("RGB", (720, 900))
    d = ImageDraw.Draw(img)
    for y in range(900):
        t = y / 899
        d.line([(0, y), (720, y)], fill=tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3)))
    d.ellipse([250, 330, 470, 550], fill=(255, 255, 255))
    buf = BytesIO()
    img.save(buf, format="JPEG", quality=78)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


PHOTOS = [placeholder((252, 236, 226), (238, 205, 190)),
          placeholder((240, 232, 244), (222, 206, 233))]

# (라벨, UA, 기대 기기, 기대 브라우저, 터치)
UAS = [
    ("아이폰 카톡", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 "
                    "(KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.4.5", "iPhone", "카톡", True),
    ("아이폰 인스타", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 "
                      "(KHTML, like Gecko) Mobile/15E148 Instagram 302.0.0.23.113", "iPhone", "인스타", True),
    ("안드로이드 삼성인터넷", "Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) "
                             "SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36", "Android", "삼성인터넷", True),
    ("안드로이드 크롬", "Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) "
                       "Chrome/119.0.6045.193 Mobile Safari/537.36", "Android", "Chrome", True),
    ("안드로이드 네이버", "Mozilla/5.0 (Linux; Android 13; SM-G991N) AppleWebKit/537.36 (KHTML, like Gecko) "
                          "Chrome/112.0.0.0 Mobile Safari/537.36 NAVER(inapp; search; 950; 12.5.1)", "Android", "네이버", True),
    ("안드로이드 웨일", "Mozilla/5.0 (Linux; Android 13; SM-G991N) AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/112.0.0.0 Whale/3.23.214.16 Mobile Safari/537.36", "Android", "웨일", True),
    ("아이폰 크롬(CriOS)", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 "
                            "(KHTML, like Gecko) CriOS/119.0.6045.169 Mobile/15E148 Safari/604.1", "iPhone", "Chrome", True),
    ("아이폰 엣지(EdgiOS)", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 "
                             "(KHTML, like Gecko) Version/17.0 EdgiOS/119.0.2151.65 Mobile/15E148 Safari/604.1", "iPhone", "Edge", True),
    ("아이패드 사파리", "Mozilla/5.0 (iPad; CPU OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) "
                         "Version/17.1 Mobile/15E148 Safari/604.1", "iPad", "Safari", True),
    ("아이패드(iPadOS 데스크톱 UA)", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
                                     "(KHTML, like Gecko) Version/17.1 Safari/605.1.15", "iPad", "Safari", True),
    ("맥 사파리", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) "
                  "Version/17.1 Safari/605.1.15", "Mac", "Safari", False),
    ("윈도우 PC 크롬", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
                       "Chrome/119.0.0.0 Safari/537.36", "PC", "Chrome", False),
    ("PC 엣지(Edg)", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
                      "Chrome/119.0.0.0 Safari/537.36 Edg/119.0.2151.58", "PC", "Edge", False),
    ("알 수 없는 UA", "Mozilla/5.0", "PC", "브라우저", False),
]

FMT = re.compile(r"^만나방 · (\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2}) · "
                 r"(iPhone|iPad|Android|Mac|PC) (카톡|인스타|네이버|삼성인터넷|웨일|Edge|Chrome|Safari|브라우저) · #(\d{2,})$")

BASE = ("https://jy-yi.github.io/manna-bang/" if MODE == "deploy"
        else f"http://127.0.0.1:{PORT}/index.html")

WM_PROBE = """() => {
  const el = document.getElementById('detailWm');
  if(!el) return {has:false};
  const cs = getComputedStyle(el);
  const bg = cs.backgroundImage || '';
  let svg = null;
  const m = bg.match(/^url\\(["']?data:image\\/svg\\+xml;charset=utf-8,([\\s\\S]*?)["']?\\)$/);
  if(m){ try { svg = decodeURIComponent(m[1]); } catch(e) {} }
  let metrics = null;
  if(svg){
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const root = doc.documentElement;
    const W = parseFloat(root.getAttribute('width')), H = parseFloat(root.getAttribute('height'));
    const cv = document.createElement('canvas'), cx = cv.getContext('2d');
    const cfg = window.__mannabang.wmCfg;
    cx.font = "800 " + cfg.font + "px 'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',sans-serif";
    const t = el.getAttribute('data-wm') || '';
    const tw = cx.measureText(t).width + cfg.ls * t.length;
    const rad = Math.PI * cfg.rot / 180, c = Math.cos(rad), s = Math.sin(rad);
    const lineH = cfg.font * cfg.lineH;
    metrics = {tileW: W, tileH: H, textW: Math.round(tw), cfg: {...cfg},
               rotW: Math.round(tw * c + lineH * s), rotH: Math.round(tw * s + lineH * c),
               texts: Array.from(root.querySelectorAll('text')).map(x => x.textContent),
               fills: Array.from(root.querySelectorAll('text')).map(x => x.getAttribute('fill')),
               rotate: (root.querySelector('g') || {}).getAttribute ? root.querySelector('g').getAttribute('transform') : null,
               gradient: /[<>]/.test(svg) ? null : null};
  }
  const r = el.getBoundingClientRect(), g = document.querySelector('#detailContent .gallery').getBoundingClientRect();
  return {has:true, hidden: el.hidden, text: el.getAttribute('data-wm'), bg: bg.slice(0, 60),
          repeat: cs.backgroundRepeat, pe: cs.pointerEvents, svg: svg, metrics: metrics,
          galleryH: Math.round(g.height), galleryW: Math.round(g.width),
          rows: metrics && metrics.tileH ? +(g.height / metrics.tileH).toFixed(2) : null,
          matchesGallery: Math.round(r.width) === Math.round(g.width) && Math.round(r.height) === Math.round(g.height),
          pageNow: (() => { const d = new Date();
            const p = n => (n < 10 ? '0' : '') + n;
            return d.getFullYear() + '.' + p(d.getMonth()+1) + '.' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); })()};
}"""


def open_photo_asset(page):
    """사진 2장이 붙은 첫 매물을 연다. 매물 id 반환."""
    pid = page.evaluate("""(ph) => {
      const st = window.__mannabang.state;
      const cards = Array.from(document.querySelectorAll('[data-open]')).map(e => e.getAttribute('data-open'));
      const id = cards[0];
      st.assets.find(x => x.id === id).photos = ph.slice();
      window.__mannabang.render();
      return id;
    }""", PHOTOS)
    page.wait_for_timeout(300)
    page.evaluate("""(id) => { const el = Array.from(document.querySelectorAll('[data-open]'))
        .find(e => e.getAttribute('data-open') === id); if(el) el.click(); }""", pid)
    page.wait_for_timeout(450)
    return pid


def no_of(pid):
    n = re.sub(r"[^0-9]", "", pid) or "0"
    return n if len(n) >= 2 else "0" + n


with sync_playwright() as p:
    if MODE == "local":
        serve()
    b = p.chromium.launch(executable_path=CHROME, args=["--no-sandbox", "--disable-dev-shm-usage"])

    print("\n=== (1) UA 판별 + 문구 포맷 + 타일 ===")
    for (label, ua, dev, br, touch) in UAS:
        ctx = b.new_context(viewport={"width": 375, "height": 812}, device_scale_factor=2,
                            is_mobile=touch, has_touch=touch, user_agent=ua)
        errs = []
        page = ctx.new_page()
        page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
        page.goto(BASE, wait_until="load")
        page.wait_for_timeout(600)
        page.click("#sampleBtn")
        page.wait_for_timeout(600)
        page.evaluate("() => { window.__mannabang.setMode('guest'); window.__mannabang.render(); }")
        page.wait_for_timeout(300)
        pid = open_photo_asset(page)
        r = page.evaluate(WM_PROBE)
        txt = r.get("text") or ""
        m = FMT.match(txt)
        check(f"{label}: 워터마크 표시", r.get("has") and r.get("hidden") is False, {"text": txt, "has": r.get("has")})
        check(f"{label}: 문구 포맷 {dev} {br} · #{no_of(pid)}", bool(m) and m.group(6) == dev and m.group(7) == br
              and m.group(8) == no_of(pid), txt)
        def mins(stamp):
            y, mo, d, hh, mi = map(int, re.split(r"[. :]", stamp))
            return ((y * 12 + mo) * 31 + d) * 1440 + hh * 60 + mi
        diff = abs(mins(txt.split(" · ")[1]) - mins(r.get("pageNow"))) if m else 10 ** 9
        check(f"{label}: 열람 시각이 지금 시각 (±1분)", bool(m) and diff <= 1,
              {"wm": txt, "pageNow": r.get("pageNow"), "diffMin": diff})
        mt = r.get("metrics") or {}
        check(f"{label}: 타일이 기울인 글자보다 큼(잘림 없음)",
              bool(mt) and mt["tileW"] >= mt["rotW"] and mt["tileH"] >= mt["rotH"],
              {"tile": [mt.get("tileW"), mt.get("tileH")], "rot": [mt.get("rotW"), mt.get("rotH")], "textW": mt.get("textW")})
        gap = (mt["tileH"] - mt["rotH"]) if mt else None
        check(f"{label}: 위아래 줄이 겹치지 않게 여백 남김(줄 사이 ≥ 6px)", gap is not None and gap >= 6, {"gap": gap})
        check(f"{label}: 갤러리 안에 워터마크 3~4줄", r.get("rows") is not None and 3.0 <= r.get("rows") <= 4.4,
              {"rows": r.get("rows"), "tileH": mt.get("tileH"), "galleryH": r.get("galleryH")})
        check(f"{label}: 타일에 같은 문구 2겹(그림자+흰색)",
              bool(mt) and len(mt.get("texts") or []) == 2 and all(t == txt for t in mt["texts"]),
              (mt.get("texts") or [])[:2])
        check(f"{label}: 흰색 0.62 + 옅은 그림자 0.16",
              bool(mt) and any("0.62" in (f or "") for f in mt["fills"]) and any("0.16" in (f or "") for f in mt["fills"]),
              mt.get("fills"))
        check(f"{label}: 반복 타일 배경", r.get("repeat") == "repeat" and ("rotate(-" + str((mt.get("cfg") or {}).get("rot"))) in (mt.get("rotate") or ""),
              {"rotate": mt.get("rotate"), "cfgRot": (mt.get("cfg") or {}).get("rot")})
        check(f"{label}: 워터마크가 갤러리 영역에만", r.get("matchesGallery") is True and r.get("pe") == "none", r.get("matchesGallery"))
        check(f"{label}: 콘솔 에러 0", len(errs) == 0, errs[:2])
        ctx.close()

    print("\n=== (2) 상세를 다시 열면 시각이 새로 찍히는가 (시계 고정) ===")
    ctx = b.new_context(viewport={"width": 375, "height": 812}, device_scale_factor=2,
                        is_mobile=True, has_touch=True, user_agent=UAS[0][1])
    errs = []
    page = ctx.new_page()
    page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
    page.goto(BASE, wait_until="load")
    page.wait_for_timeout(600)
    page.click("#sampleBtn")
    page.wait_for_timeout(600)
    page.evaluate("() => { window.__mannabang.setMode('guest'); window.__mannabang.render(); }")
    page.evaluate("""() => {
      window.__RealDate = Date;
      const fix = iso => { const t = new __RealDate(iso).getTime();
        window.Date = class extends __RealDate { constructor(...a){ if(!a.length) super(t); else super(...a); }
          static now(){ return t; } }; };
      window.__setClock = fix;
      fix('2026-11-20T09:46:00');
    }""")
    pid = open_photo_asset(page)
    r1 = page.evaluate(WM_PROBE)
    print("1차:", r1.get("text"))
    page.evaluate("() => { document.querySelector('#detailOverlay .modal-x').click(); }")
    page.wait_for_timeout(300)
    page.evaluate("() => window.__setClock('2026-11-20T10:07:00')")
    page.evaluate("""(id) => { const el = Array.from(document.querySelectorAll('[data-open]'))
        .find(e => e.getAttribute('data-open') === id); if(el) el.click(); }""", pid)
    page.wait_for_timeout(450)
    r2 = page.evaluate(WM_PROBE)
    print("2차:", r2.get("text"))
    check("상세를 열 때마다 열람 시각 갱신", r1.get("text") == "만나방 · 2026.11.20 09:46 · iPhone 카톡 · #" + no_of(pid)
          and r2.get("text") == "만나방 · 2026.11.20 10:07 · iPhone 카톡 · #" + no_of(pid),
          {"1차": r1.get("text"), "2차": r2.get("text")})

    print("\n=== (3) 라이트박스 ===")
    page.evaluate("() => document.querySelector('#detailContent .slide.on').click()")
    page.wait_for_timeout(500)
    lw = page.evaluate("""() => {
      const w = document.getElementById('lightboxWm'), img = document.getElementById('lightboxImg');
      const cs = getComputedStyle(w);
      const wr = w.getBoundingClientRect(), ir = img.getBoundingClientRect();
      const m = (cs.backgroundImage || '').match(/^url\\(["']?data:image\\/svg\\+xml;charset=utf-8,([\\s\\S]*?)["']?\\)$/);
      let svg = null; if(m){ try { svg = decodeURIComponent(m[1]); } catch(e){} }
      return {open: !document.getElementById('lightbox').hidden, hidden: w.hidden, text: w.getAttribute('data-wm'),
              pe: cs.pointerEvents, repeat: cs.backgroundRepeat, hasSvg: !!svg,
              same: Math.round(wr.width) === Math.round(ir.width) && Math.round(wr.height) === Math.round(ir.height)};
    }""")
    print("라이트박스:", lw)
    check("상세 사진 탭 → 라이트박스 열림", lw["open"])
    check("라이트박스 워터마크 표시", lw["hidden"] is False and lw["hasSvg"])
    check("라이트박스 문구 = 같은 매물·같은 기기·현재 시각", lw["text"] == "만나방 · 2026.11.20 10:07 · iPhone 카톡 · #" + no_of(pid), lw["text"])
    check("라이트박스 워터마크가 사진 영역과 일치", lw["same"])
    check("라이트박스 워터마크도 포인터 통과", lw["pe"] == "none")
    page.screenshot(path="/workspace/downloads/만나방_식별워터마크_라이트박스_20261120.png")
    page.evaluate("() => document.getElementById('lightboxClose').click()")
    page.wait_for_timeout(300)
    page.evaluate("() => { document.querySelector('#detailOverlay .modal-x').click(); window.Date = window.__RealDate; }")
    page.wait_for_timeout(300)

    print("\n=== (4) 주선자 모드 미노출 ===")
    page.evaluate("() => { window.__mannabang.setMode('agent'); window.__mannabang.render(); }")
    page.wait_for_timeout(300)
    page.evaluate("""(id) => { const el = Array.from(document.querySelectorAll('[data-open]'))
        .find(e => e.getAttribute('data-open') === id); if(el) el.click(); }""", pid)
    page.wait_for_timeout(450)
    ag = page.evaluate("""() => {
      const w = document.getElementById('detailWm');
      return {detail: !!w, tools: document.querySelectorAll('#detailContent .g-tools .shot-btn').length};
    }""")
    check("주선자 모드: 상세 갤러리에 워터마크 요소 없음", ag["detail"] is False, ag)
    check("주선자 모드: 일괄 저장·공유 버튼은 그대로", ag["tools"] >= 1, ag)
    page.evaluate("() => document.querySelector('#detailContent .slide.on').click()")
    page.wait_for_timeout(500)
    lwa = page.evaluate("""() => { const w = document.getElementById('lightboxWm');
      return {hidden: w.hidden, text: w.getAttribute('data-wm'), bg: getComputedStyle(w).backgroundImage}; }""")
    check("주선자 모드: 라이트박스 워터마크 숨김", lwa["hidden"] is True, lwa["hidden"])
    page.evaluate("() => document.getElementById('lightboxClose').click()")
    page.wait_for_timeout(300)
    page.evaluate("() => document.querySelector('#detailOverlay .modal-x').click()")
    page.wait_for_timeout(300)
    check("콘솔 에러 0 (전체 흐름)", len(errs) == 0, errs[:3])
    ctx.close()

    print("\n=== (5) 이스케이프 ===")
    ctx = b.new_context(viewport={"width": 375, "height": 812})
    page = ctx.new_page()
    page.goto(BASE, wait_until="load")
    page.wait_for_timeout(500)
    esc = page.evaluate("""() => {
      const raw = '<&>"\\'만나방';
      const M = window.__mannabang;
      const out = M.wmXml(raw);
      const svg = M.wmSvg(raw);
      const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
      const bad = doc.querySelector('parsererror');
      return {out, ok: !bad, text: bad ? null : doc.querySelector('text').textContent, parses: svg.indexOf('<svg') === 0};
    }""")
    check("wmXml 가 & < > \" ' 를 이스케이프", esc["out"] == "&lt;&amp;&gt;&quot;&#39;만나방", esc["out"])
    check("특수문자가 든 문구도 정상 SVG 로 파싱", esc["ok"] and esc["text"] == "<&>\"'만나방" and esc["parses"], esc.get("text"))
    ctx.close()

    # 배포본 스크린샷 — 손님 모드 상세 화면
    print("\n=== (6) 스크린샷 ===")
    ctx = b.new_context(viewport={"width": 375, "height": 812}, device_scale_factor=2,
                        is_mobile=True, has_touch=True, user_agent=UAS[0][1])
    page = ctx.new_page()
    page.goto(BASE, wait_until="load")
    page.wait_for_timeout(600)
    page.click("#sampleBtn")
    page.wait_for_timeout(600)
    page.evaluate("() => { window.__mannabang.setMode('guest'); window.__mannabang.render(); }")
    page.wait_for_timeout(300)
    spid = open_photo_asset(page)
    page.wait_for_timeout(400)
    page.screenshot(path=SHOT)
    print("screenshot:", SHOT, "매물", spid)
    ctx.close()

    # PC 화면(가로 720×360 갤러리)에서도 3~4줄인지
    print("\n=== (7) PC 갤러리 줄 수 ===")
    ctx = b.new_context(viewport={"width": 1100, "height": 900}, device_scale_factor=2)
    page = ctx.new_page()
    page.goto(BASE, wait_until="load")
    page.wait_for_timeout(600)
    page.click("#sampleBtn")
    page.wait_for_timeout(600)
    page.evaluate("() => { window.__mannabang.setMode('guest'); window.__mannabang.render(); }")
    page.wait_for_timeout(300)
    dp = open_photo_asset(page)
    r = page.evaluate(WM_PROBE)
    check("PC: 갤러리 안에 워터마크 3~4줄", r.get("rows") is not None and 3.0 <= r.get("rows") <= 4.4,
          {"rows": r.get("rows"), "tileH": (r.get("metrics") or {}).get("tileH"), "gallery": [r.get("galleryW"), r.get("galleryH")]})
    page.screenshot(path="/workspace/downloads/만나방_식별워터마크_촘촘_PC_20261120.png")
    ctx.close()
    b.close()

passed = sum(1 for _, ok in results if ok)
print(f"\n=== {passed}/{len(results)} PASS ===")
sys.exit(0 if passed == len(results) else 1)
