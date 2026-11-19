#!/usr/bin/env python3
"""만나방 — (A) 상세 모달 상단 잘림, (B) 라이트박스 핀치 확대 검증.

(A) 안드로이드 삼성인터넷/크롬은 주소창·툴바가 펼쳐진 상태에서 실제 보이는 높이(visualViewport.height)
    < vh 기준 높이(레이아웃 뷰포트) 가 된다. 페이지 맨 위(1·2번 매물 위치)에서 시트를 열면 92vh 가
    화면보다 커져 상단(사진·일괄 저장/공유·×)이 잘렸다. visualViewport.height 를 더 작게 오버라이드해
    그 상황을 흉내 내고, 모달이 보이는 영역 안에 온전히 들어오는지 확인한다.

호출: python3 verify-modaltop.py local|deploy
"""
import sys, os, base64, functools, http.server, threading
from io import BytesIO
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.abspath(__file__))
MODE = sys.argv[1] if len(sys.argv) > 1 else "local"
PORT = 8797
CHROME = "/workspace/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell"
SHOT = "/workspace/downloads/만나방_모달상단_수정_20261120.png"
SHOT2 = "/workspace/downloads/만나방_라이트박스_핀치확대_20261120.png"
SHOT3 = "/workspace/downloads/만나방_손님_워터마크_20261120.png"


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
          placeholder((240, 232, 244), (222, 206, 233)),
          placeholder((232, 241, 236), (206, 226, 216))]

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


base = ("https://jy-yi.github.io/manna-bang/" if MODE == "deploy"
        else f"http://127.0.0.1:{PORT}/index.html")

PROBE = """() => {
  const q = s => document.querySelector(s);
  const R = el => { if(!el) return null; const r = el.getBoundingClientRect();
    return {top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), h: Math.round(r.height)}; };
  const m = q('#detailOverlay .modal');
  const ov = q('#detailOverlay');
  const vis = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
  const btns = Array.from(document.querySelectorAll('#detailContent .g-tools .shot-btn')).map(R);
  return {
    vis: Math.round(vis), innerH: window.innerHeight,
    modal: R(m), modalScrollTop: m ? m.scrollTop : null,
    modalMaxH: m ? getComputedStyle(m).maxHeight : null,
    overlayH: ov ? Math.round(ov.getBoundingClientRect().height) : null,
    x: R(q('#detailOverlay .modal-x')),
    tools: R(q('#detailContent .g-tools')),
    btn1: btns[0] || null, btn2: btns[1] || null,
    gallery: R(q('#detailContent .gallery'))
  };
}"""

FAKE_VV = """(vvh) => {
  try {
    Object.defineProperty(window, 'visualViewport', {configurable: true, value: {
      height: vvh, width: window.innerWidth, offsetTop: 0, offsetLeft: 0,
      scale: 1, pageTop: 0, pageLeft: 0,
      addEventListener(){}, removeEventListener(){}
    }});
    window.dispatchEvent(new Event('resize'));
  } catch(e) { console.log('vv override failed ' + e); }
}"""

with sync_playwright() as p:
    if MODE == "local":
        serve()
    b = p.chromium.launch(executable_path=CHROME, args=["--no-sandbox", "--disable-dev-shm-usage"])

    # ============ (A) 상세 모달 상단이 화면 밖으로 나가지 않는가 ============
    print("\n=== (A) 상세 모달 상단 ===")
    for (W, H, vvh) in [(375, 667, 587), (360, 640, 553), (412, 915, 830), (375, 812, 812)]:
        ctx = b.new_context(viewport={"width": W, "height": H}, device_scale_factor=2,
                            is_mobile=True, has_touch=True)
        errs = []
        page = ctx.new_page()
        page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
        page.goto(base, wait_until="load")
        page.wait_for_timeout(700)
        page.click("#sampleBtn")
        page.wait_for_timeout(700)

        # 주소창·툴바가 차지한 만큼 실제 보이는 높이를 줄인다 (안드로이드 크롬/삼성인터넷 흉내)
        page.evaluate(FAKE_VV, vvh)
        page.wait_for_timeout(400)

        ids = page.evaluate("""() => {
          const st = window.__mannabang.state;
          const cards = Array.from(document.querySelectorAll('[data-open]')).map(e => e.getAttribute('data-open'));
          const get = id => st.assets.find(x => x.id === id);
          const withPhotos = cards.filter(id => (get(id).photos || []).length);
          const target = withPhotos.length ? withPhotos[0] : cards[0];
          return {target: target, other: cards.filter(c => c !== target)[0] || null};
        }""")

        # 목록을 조금 스크롤한 상태에서 카드를 연다 (실제 사용 상황)
        page.evaluate("() => window.scrollTo(0, 200)")
        page.wait_for_timeout(150)
        page.evaluate("(id) => document.querySelector('[data-open=\"' + id + '\"]').click()", ids["target"])
        page.wait_for_timeout(600)

        tag = f"{W}x{H}/보임{vvh}"
        r = page.evaluate(PROBE)
        print(tag, r)
        check(f"{tag}: 모달 높이 <= 보이는 높이 (vh 초과 없음)", r["modal"]["h"] <= r["vis"], {"modalH": r["modal"]["h"], "vis": r["vis"]})
        check(f"{tag}: 모달 top >= 0 (위로 넘치지 않음)", r["modal"]["top"] >= 0, r["modal"])
        check(f"{tag}: 모달 bottom <= 보이는 높이", r["modal"]["bottom"] <= r["vis"] + 1, {"bottom": r["modal"]["bottom"], "vis": r["vis"]})
        check(f"{tag}: 열자마자 scrollTop == 0", r["modalScrollTop"] == 0, r["modalScrollTop"])
        check(f"{tag}: × 닫기 버튼 화면 안", r["x"] and r["x"]["top"] >= 0 and r["x"]["bottom"] <= r["vis"], r["x"])
        if r["btn1"]:
            check(f"{tag}: 일괄 저장 버튼 화면 안", r["btn1"]["top"] >= 0 and r["btn1"]["bottom"] <= r["vis"], r["btn1"])
            check(f"{tag}: 일괄 공유 버튼 화면 안", r["btn2"]["top"] >= 0 and r["btn2"]["bottom"] <= r["vis"], r["btn2"])
            hit = page.evaluate("""() => {
              const b = document.querySelector('#detailContent [data-action=\\'save-all-photos\\']');
              const rb = b.getBoundingClientRect();
              const el = document.elementFromPoint(rb.left + rb.width/2, rb.top + rb.height/2);
              return {ok: !!el && (el === b || b.contains(el)), hit: el ? el.tagName + '.' + el.className : null, y: Math.round(rb.top)};
            }""")
            check(f"{tag}: 일괄 저장 버튼이 실제 클릭되는 위치", hit["ok"], hit)
        check(f"{tag}: 사진(갤러리) 상단 화면 안", r["gallery"] and r["gallery"]["top"] >= 0, r["gallery"])

        # 스크롤해도 ×는 화면 위쪽에 남는다
        page.evaluate("() => { document.querySelector('#detailOverlay .modal').scrollTop = 500; }")
        page.wait_for_timeout(350)
        xr = page.evaluate("""() => {
          const x = document.querySelector('#detailOverlay .modal-x');
          const r = x.getBoundingClientRect();
          const vis = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
          const el = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
          return {top: Math.round(r.top), bottom: Math.round(r.bottom), vis: Math.round(vis),
                  clickable: !!el && (el === x || x.contains(el) || x.contains(el.parentElement))};
        }""")
        check(f"{tag}: 스크롤해도 × 화면 위쪽에 보임", xr["top"] >= 0 and xr["bottom"] <= xr["vis"], xr)

        # 스크롤 → 닫기 → 다른 매물 열기 : 다시 최상단
        page.evaluate("() => document.querySelector('#detailOverlay .modal-x').click()")
        page.wait_for_timeout(400)
        if ids["other"]:
            page.evaluate("(id) => document.querySelector('[data-open=\"' + id + '\"]').click()", ids["other"])
            page.wait_for_timeout(600)
            r2 = page.evaluate(PROBE)
            check(f"{tag}: 다시 열어도 scrollTop == 0", r2["modalScrollTop"] == 0, r2["modalScrollTop"])
            check(f"{tag}: 다시 열어도 top >= 0", r2["modal"]["top"] >= 0, r2["modal"])
            check(f"{tag}: 다시 열어도 × 화면 안", r2["x"]["top"] >= 0, r2["x"])
            page.evaluate("() => document.querySelector('#detailOverlay .modal-x').click()")
            page.wait_for_timeout(300)

        # 다른 모달(매물 등록·방장 관리)도 같은 기준
        page.evaluate("() => document.getElementById('btnNew').click()")
        page.wait_for_timeout(500)
        fr = page.evaluate("""() => {
          const m = document.querySelector('#formOverlay .modal');
          const vis = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
          if(!m || document.getElementById('formOverlay').hidden) return null;
          const r = m.getBoundingClientRect();
          return {top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height),
                  scrollTop: m.scrollTop, vis: Math.round(vis)};
        }""")
        check(f"{tag}: 등록 모달 화면 안 + scrollTop 0", bool(fr) and fr["top"] >= 0 and fr["bottom"] <= fr["vis"] + 1 and fr["scrollTop"] == 0, fr)
        page.evaluate("() => document.querySelector('#formOverlay .modal-x').click()")
        page.wait_for_timeout(300)

        if (W, H) == (375, 667):
            page.evaluate("(id) => document.querySelector('[data-open=\"' + id + '\"]').click()", ids["target"])
            page.wait_for_timeout(700)
            page.screenshot(path=SHOT)
            print("screenshot:", SHOT)

        check(f"{tag}: 콘솔 에러 0", len(errs) == 0, errs[:3])
        ctx.close()

    # ============ (B) 라이트박스 핀치 확대 + 스와이프 + 손님 워터마크 ============
    print("\n=== (B) 라이트박스·워터마크 ===")
    ctx = b.new_context(viewport={"width": 375, "height": 667}, device_scale_factor=2,
                        is_mobile=True, has_touch=True)
    errs = []
    page = ctx.new_page()
    page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
    page.goto(base, wait_until="load")
    page.wait_for_timeout(700)
    page.click("#sampleBtn")
    page.wait_for_timeout(700)

    vp = page.eval_on_selector("meta[name=viewport]", "e => e.getAttribute('content')")
    check("viewport 에 user-scalable=no / maximum-scale 없음", "user-scalable=no" not in vp and "maximum-scale" not in vp, vp)

    # 실제 사진 3장을 가진 매물로 바꾼다 (샘플은 사진이 없어 라이트박스가 열리지 않음)
    pid = page.evaluate("""(ph) => {
      const st = window.__mannabang.state;
      const cards = Array.from(document.querySelectorAll('[data-open]')).map(e => e.getAttribute('data-open'));
      const id = cards[0];
      st.assets.find(x => x.id === id).photos = ph.slice();
      window.__mannabang.render();
      return id;
    }""", PHOTOS)
    page.wait_for_timeout(400)

    def open_detail(mode=None):
        if mode:
            page.evaluate("(m) => { window.__mannabang.setMode(m); window.__mannabang.render(); }", mode)
            page.wait_for_timeout(300)
        page.evaluate("(id) => { const el = Array.from(document.querySelectorAll('[data-open]')).find(e => e.getAttribute('data-open') === id); if(el) el.click(); }", pid)
        page.wait_for_timeout(550)

    def close_detail():
        page.evaluate("() => { const x = document.querySelector('#detailOverlay .modal-x'); if(x) x.click(); }")
        page.wait_for_timeout(350)

    def wm_probe():
        return page.evaluate("""() => {
          const g = document.querySelector('#detailContent .gallery');
          const w = document.getElementById('detailWm');
          const R = el => { const r = el.getBoundingClientRect(); return {top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height)}; };
          const cs = w ? getComputedStyle(w) : null;
          return {has: !!w, hidden: w ? w.hidden : null,
                  pe: cs ? cs.pointerEvents : null, us: cs ? cs.userSelect : null,
                  bg: cs ? (cs.backgroundImage || '').slice(0, 30) : null, repeat: cs ? cs.backgroundRepeat : null,
                  z: cs ? cs.zIndex : null,
                  wmRect: w ? R(w) : null, galRect: g ? R(g) : null,
                  overflow: cs ? cs.overflow : null};
        }""")

    # --- 주선자 모드: 워터마크 없어야 함 ---
    open_detail("agent")
    agent_wm = wm_probe()
    check("주선자 모드: 갤러리 워터마크 없음", not agent_wm["has"], agent_wm)

    # --- 주선자 모드 라이트박스 ---
    page.evaluate("() => document.querySelector('#detailContent .slide.on').click()")
    page.wait_for_timeout(500)
    check("상세 갤러리 사진 탭 → 라이트박스 열림", page.eval_on_selector("#lightbox", "e => !e.hidden"))
    check("주선자 모드: 라이트박스 워터마크 없음",
          page.eval_on_selector("#lightboxWm", "e => e.hidden === true"),
          page.eval_on_selector("#lightboxWm", "e => ({hidden: e.hidden, bg: getComputedStyle(e).backgroundImage.slice(0,20)})"))
    ta = page.evaluate("""() => {
      const lb = document.getElementById('lightbox'), img = document.getElementById('lightboxImg');
      return {lb: getComputedStyle(lb).touchAction, img: getComputedStyle(img).touchAction};
    }""")
    check("라이트박스 touch-action 이 핀치 허용(pinch-zoom)", ta["lb"] == "pinch-zoom", ta)
    check("라이트박스 이미지 touch-action 이 핀치 허용(pinch-zoom)", ta["img"] == "pinch-zoom", ta)
    page.evaluate("() => document.getElementById('lightboxClose').click()")
    page.wait_for_timeout(400)
    close_detail()

    # --- 손님 모드: 갤러리 워터마크 ---
    open_detail("guest")
    gw = wm_probe()
    print("손님 갤러리 워터마크:", gw)
    check("손님 모드: 갤러리 워터마크 표시", gw["has"] and gw["hidden"] is False, gw)
    check("워터마크는 포인터를 막지 않음(pointer-events:none)", gw["pe"] == "none", gw["pe"])
    check("워터마크 선택 불가(user-select:none)", gw["us"] == "none", gw["us"])
    check("워터마크는 반복 타일 배경", gw["repeat"] == "repeat" and "svg" in (gw["bg"] or ""), {"repeat": gw["repeat"], "bg": gw["bg"]})
    check("워터마크가 갤러리 영역에만 깔림(overflow hidden)",
          gw["overflow"] == "hidden" and gw["wmRect"]["h"] == gw["galRect"]["h"] and gw["wmRect"]["w"] == gw["galRect"]["w"],
          {"wm": gw["wmRect"], "gal": gw["galRect"]})
    check("손님 모드: 일괄 저장·공유 버튼 없음",
          page.eval_on_selector_all("#detailContent .g-tools .shot-btn", "els => els.length") == 0)
    ctxmenu = page.evaluate("""() => {
      const img = document.querySelector('#detailContent .slide.on img');
      if(!img) return {noimg: true};
      const ev = new MouseEvent('contextmenu', {bubbles: true, cancelable: true});
      img.dispatchEvent(ev);
      const cs = getComputedStyle(img);
      return {prevented: ev.defaultPrevented, select: cs.userSelect, drag: cs.webkitUserDrag || cs.getPropertyValue('-webkit-user-drag')};
    }""")
    check("손님 모드: 사진 우클릭·길게누르기 저장 메뉴 차단", ctxmenu.get("prevented") is True, ctxmenu)
    check("손님 모드: 사진 선택·드래그 불가", ctxmenu.get("select") == "none", ctxmenu)
    page.screenshot(path=SHOT3)
    print("screenshot:", SHOT3)

    # 워터마크가 있어도 사진 탭은 그대로 라이트박스를 연다
    page.evaluate("() => document.querySelector('#detailContent .slide.on').click()")
    page.wait_for_timeout(600)
    lw = page.evaluate("""() => {
      const w = document.getElementById('lightboxWm');
      const img = document.getElementById('lightboxImg');
      const cs = getComputedStyle(w);
      const R = el => { const r = el.getBoundingClientRect(); return {top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height)}; };
      const ir = R(img), wr = R(w);
      const el = document.elementFromPoint(ir.left + ir.w/2, ir.top + ir.h/2);
      return {open: !document.getElementById('lightbox').hidden, hidden: w.hidden, pe: cs.pointerEvents,
              wm: wr, img: ir, topEl: el ? el.tagName + '#' + el.id : null};
    }""")
    print("손님 라이트박스:", lw)
    check("손님 모드: 워터마크 때문에 사진 탭이 막히지 않음(라이트박스 열림)", lw["open"], lw)
    check("손님 모드: 라이트박스 워터마크 표시", lw["hidden"] is False, lw)
    check("라이트박스 워터마크가 사진 영역과 일치", lw["wm"]["w"] == lw["img"]["w"] and lw["wm"]["h"] == lw["img"]["h"], {"wm": lw["wm"], "img": lw["img"]})
    check("라이트박스 워터마크도 포인터 통과", lw["pe"] == "none", lw["pe"])

    def lb_state():
        return page.evaluate("""() => ({
          no: document.getElementById('lightboxNo').textContent,
          open: !document.getElementById('lightbox').hidden,
          scale: window.visualViewport ? Math.round(window.visualViewport.scale * 100) / 100 : null
        })""")

    before = lb_state()
    print("열림:", before)

    # 실제 두 손가락 핀치 — CDP 로 두 손가락을 벌려 브라우저 확대를 일으킨다
    cdp = ctx.new_cdp_session(page)
    box = page.eval_on_selector("#lightboxImg", "e => { const r = e.getBoundingClientRect(); return {x: r.left + r.width/2, y: r.top + r.height/2}; }")

    def pinch(cx, cy, steps=12, spread=10):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [
            {"x": cx - 40, "y": cy, "id": 1}, {"x": cx + 40, "y": cy, "id": 2}]})
        for i in range(1, steps + 1):
            cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [
                {"x": cx - 40 - i * spread, "y": cy, "id": 1}, {"x": cx + 40 + i * spread, "y": cy, "id": 2}]})
            page.wait_for_timeout(18)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        page.wait_for_timeout(700)

    def reset_scale():
        try:
            cdp.send("Emulation.setPageScaleFactor", {"pageScaleFactor": 1})
        except Exception as e:
            print("  scale reset 실패", e)
        page.wait_for_timeout(300)

    before = lb_state()
    print("열림:", before)
    pinch(box["x"], box["y"])
    after_pinch = lb_state()
    print("핀치 후:", after_pinch)
    check("두 손가락 핀치로 확대됨 (visualViewport.scale > 1)", (after_pinch["scale"] or 0) > 1, after_pinch)
    check("핀치 중 사진이 다른 장으로 넘어가지 않음", after_pinch["no"] == before["no"], {"before": before["no"], "after": after_pinch["no"]})
    check("핀치로 라이트박스가 닫히지 않음", after_pinch["open"], after_pinch)
    page.screenshot(path=SHOT2)
    print("screenshot:", SHOT2)

    # 대조군 — 예전처럼 touch-action:none 이었다면 확대가 막힌다 (원인 증명)
    reset_scale()
    page.evaluate("() => { const l = document.getElementById('lightbox'), i = document.getElementById('lightboxImg'); l.dataset.ta = '1'; i.dataset.ta = '1'; l.style.touchAction = 'none'; i.style.touchAction = 'none'; }")
    page.wait_for_timeout(200)
    pinch(box["x"], box["y"])
    ctrl = lb_state()
    print("대조군(touch-action:none) 핀치 후:", ctrl)
    check("대조군: touch-action:none 이면 확대가 막혀 scale 그대로", (ctrl["scale"] or 1) <= 1.01, ctrl)
    page.evaluate("() => { const l = document.getElementById('lightbox'), i = document.getElementById('lightboxImg'); l.style.touchAction = ''; i.style.touchAction = ''; }")
    reset_scale()
    page.wait_for_timeout(200)

    # 두 손가락 터치 이벤트로 스와이프 핸들러가 오인하지 않는지
    mt = page.evaluate("""async () => {
      const lb = document.getElementById('lightbox');
      const mk = (type, pts) => {
        const touches = pts.map((p, i) => new Touch({identifier: i, target: lb, clientX: p[0], clientY: p[1],
                                                      pageX: p[0], pageY: p[1], screenX: p[0], screenY: p[1]}));
        return new TouchEvent(type, {bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : touches,
                                     targetTouches: type === 'touchend' ? [] : touches, changedTouches: touches});
      };
      const no0 = document.getElementById('lightboxNo').textContent;
      lb.dispatchEvent(mk('touchstart', [[100, 300], [240, 300]]));
      lb.dispatchEvent(mk('touchmove',  [[40, 300], [300, 300]]));
      lb.dispatchEvent(mk('touchmove',  [[20, 300], [330, 300]]));
      lb.dispatchEvent(mk('touchend',   [[20, 300], [330, 300]]));
      await new Promise(r => setTimeout(r, 250));
      return {same: document.getElementById('lightboxNo').textContent === no0,
              open: !document.getElementById('lightbox').hidden};
    }""")
    check("두 손가락 제스처로는 사진이 넘어가지 않음", mt["same"], mt)
    check("두 손가락 제스처로 라이트박스가 닫히지 않음", mt["open"], mt)

    # 한 손가락 스와이프는 그대로 동작
    one = page.evaluate("""async () => {
      const lb = document.getElementById('lightbox');
      const mk = (type, pts) => {
        const touches = pts.map((p, i) => new Touch({identifier: 0, target: lb, clientX: p[0], clientY: p[1],
                                                      pageX: p[0], pageY: p[1], screenX: p[0], screenY: p[1]}));
        return new TouchEvent(type, {bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : touches,
                                     targetTouches: type === 'touchend' ? [] : touches, changedTouches: touches});
      };
      const no0 = document.getElementById('lightboxNo').textContent;
      lb.dispatchEvent(mk('touchstart', [[300, 300]]));
      lb.dispatchEvent(mk('touchmove',  [[240, 302]]));
      lb.dispatchEvent(mk('touchmove',  [[170, 305]]));
      lb.dispatchEvent(mk('touchend',   [[170, 305]]));
      await new Promise(r => setTimeout(r, 300));
      return {before: no0, after: document.getElementById('lightboxNo').textContent};
    }""")
    check("한 손가락 스와이프는 여전히 사진을 넘김", one["before"] != one["after"], one)

    # 주선자 모드에서는 우클릭 차단 없음
    page.evaluate("() => { window.__mannabang.setMode('agent'); window.__mannabang.render(); }")
    page.wait_for_timeout(300)
    actx = page.evaluate("""() => {
      const img = document.querySelector('#detailContent .slide.on img');
      const ev = new MouseEvent('contextmenu', {bubbles: true, cancelable: true});
      img.dispatchEvent(ev);
      return {prevented: ev.defaultPrevented};
    }""")
    check("주선자 모드: 사진 우클릭 차단 없음", actx["prevented"] is False, actx)
    page.evaluate("() => { window.__mannabang.setMode('guest'); window.__mannabang.render(); }")
    page.wait_for_timeout(300)

    # 손님 모드 상세 갤러리 스와이프도 워터마크에 막히지 않는지
    page.evaluate("() => document.getElementById('lightboxClose').click()")
    page.wait_for_timeout(400)
    gsw = page.evaluate("""async () => {
      const gal = document.querySelector('#detailContent .gallery');
      const mk = (type, pts) => {
        const touches = pts.map((p, i) => new Touch({identifier: 0, target: gal, clientX: p[0], clientY: p[1],
                                                      pageX: p[0], pageY: p[1], screenX: p[0], screenY: p[1]}));
        return new TouchEvent(type, {bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : touches,
                                     targetTouches: type === 'touchend' ? [] : touches, changedTouches: touches});
      };
      const on0 = Array.from(gal.querySelectorAll('.slide')).findIndex(s => s.classList.contains('on'));
      gal.dispatchEvent(mk('touchstart', [[300, 200]]));
      gal.dispatchEvent(mk('touchmove',  [[240, 202]]));
      gal.dispatchEvent(mk('touchmove',  [[170, 205]]));
      gal.dispatchEvent(mk('touchend',   [[170, 205]]));
      await new Promise(r => setTimeout(r, 300));
      return {before: on0, after: Array.from(gal.querySelectorAll('.slide')).findIndex(s => s.classList.contains('on'))};
    }""")
    check("손님 갤러리 스와이프도 그대로 동작", gsw["before"] != gsw["after"], gsw)

    check("(B) 콘솔 에러 0", len(errs) == 0, errs[:3])
    ctx.close()
    b.close()

print("\n=== %d/%d PASS ===" % (sum(1 for _, ok in results if ok), len(results)))
if not all(ok for _, ok in results):
    print("FAILED:", [n for n, ok in results if not ok])
    sys.exit(1)
