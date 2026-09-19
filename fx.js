/* =========================================================
   NV — CRT 지직 효과

   .screen 안쪽에 투명한 막을 한 장 깔고 그 위에
   노이즈 / 흘러내리는 띠 / 깜빡임 / 가끔 터지는 지직을 그린다.

   ★ 숫자는 전부 아래 FX 한 덩어리에 모여 있다. 여기만 고치면 된다.
   ★ 색이나 두께 같은 "모양"은 style.css 맨 아래
     "CRT 지직 효과" 칸에 있다.
   ★ 이 파일은 .screen 이 있는 페이지 어디에 붙여도 그대로 돈다.
     (.screen 이 없으면 아무 일도 안 하고 조용히 끝난다)
   ========================================================= */

const FX = {
  MOUNT: '.screen',   // 효과를 씌울 상자. 모든 페이지가 .screen 을 쓴다
  Z: 5,               // 겹치는 순서. 스캔라인보다 위로 올리려고 5

  NOISE: 0.015,       // 지직 노이즈 진하기 (0 ~ 0.25)
  NOISE_FPS: 12,      // 노이즈 갱신 속도. 낮으면 필름 입자, 높으면 TV 모래알
  NOISE_SIZE: 2,      // 노이즈 알갱이 크기(px)

  BAND: 0.03,         // 흘러내리는 밝은 띠 세기
  BAND_SEC: 2,        // 띠가 한 번 내려오는 시간(초)
  FLICKER: 0.02,      // 화면 깜빡임 세기

  BURST_MIN: 4.5,     // 지직이 터지는 최소 간격(초)
  BURST_MAX: 15,      // 지직이 터지는 최대 간격(초)
  BURST_SEC: 0.5,     // 지직 한 번의 길이(초)
  SHAKE: 0,           // 지직 때 화면이 흔들리는 정도(px). 0 이면 안 흔들림
  VIGNETTE: 0.9       // 가장자리 어둡기 (0 ~ 0.9)
};


(function(){

  function start(){
    const mount = document.querySelector(FX.MOUNT);
    if(!mount) return;                    // 이 페이지엔 .screen 이 없다

    mount.classList.add('fx-root');
    if(getComputedStyle(mount).position === 'static'){
      mount.style.position = 'relative';  // 막을 안쪽에 붙이려면 기준점이 필요
    }

    /* 위에서 정한 숫자를 CSS 변수로 넘긴다.
       style.css 쪽은 var(--fx-...) 만 읽으면 되니까 서로 안 엉킨다. */
    const s = mount.style;
    s.setProperty('--fx-noise',     String(FX.NOISE));
    s.setProperty('--fx-band',      String(FX.BAND));
    s.setProperty('--fx-band-sec',  FX.BAND_SEC + 's');
    s.setProperty('--fx-flicker',   String(FX.FLICKER));
    s.setProperty('--fx-shake',     String(FX.SHAKE));
    s.setProperty('--fx-burst-sec', FX.BURST_SEC + 's');
    s.setProperty('--fx-vig',       String(FX.VIGNETTE));
    s.setProperty('--fx-z',         String(FX.Z));

    /* 막 한 장에 다섯 겹을 전부 담는다 */
    const layer = document.createElement('div');
    layer.className = 'fx-layer';
    layer.setAttribute('aria-hidden', 'true');   // 스크린리더는 무시하게
    layer.innerHTML =
      '<canvas class="fx-noise"></canvas>' +
      '<div class="fx-band"></div>' +
      '<div class="fx-flicker"></div>' +
      '<div class="fx-tear"></div><div class="fx-tear"></div>' +
      '<div class="fx-vig"></div>';
    mount.appendChild(layer);


    /* ---------------------------------------------------------
       노이즈
       화면 크기 그대로 난수를 뿌리면 프레임이 떨어진다.
       그래서 1/NOISE_SIZE 크기의 작은 캔버스에 그리고
       CSS 로 늘려서 알갱이를 만든다.
       --------------------------------------------------------- */
    const cv = layer.querySelector('.fx-noise');
    const cx = cv.getContext('2d');
    let buf = null;

    function resize(){
      cv.width  = Math.max(1, Math.ceil(mount.clientWidth  / FX.NOISE_SIZE));
      cv.height = Math.max(1, Math.ceil(mount.clientHeight / FX.NOISE_SIZE));
      buf = cx.createImageData(cv.width, cv.height);   // 매 프레임 새로 만들면 낭비라 한 번만
    }
    resize();
    window.addEventListener('resize', resize);

    let last = 0;
    function paint(t){
      requestAnimationFrame(paint);
      if(t - last < 1000 / FX.NOISE_FPS) return;       // NOISE_FPS 로 속도 제한
      last = t;

      const d = buf.data;
      for(let i = 0; i < d.length; i += 4){
        const g = (Math.random() * 255) | 0;           // | 0 은 소수점 버리기
        d[i]     = g * 0.30;   // R
        d[i + 1] = g;          // G — 초록만 세게
        d[i + 2] = g * 0.50;   // B
        d[i + 3] = 255;        // 투명도는 CSS 쪽 opacity 로 조절
      }
      cx.putImageData(buf, 0, 0);
    }
    requestAnimationFrame(paint);


    /* ---------------------------------------------------------
       지직 터뜨리기
       BURST_MIN ~ BURST_MAX 초 사이에서 무작위로 한 번씩.
       규칙적으로 터지면 금방 지겨워진다.
       --------------------------------------------------------- */
    const tears = layer.querySelectorAll('.fx-tear');
    const noMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let timer = null;

    function burst(){
      tears.forEach(el => {
        el.style.top    = (Math.random() * 90) + '%';        // 찢김 위치
        el.style.height = (2 + Math.random() * 14) + 'px';   // 찢김 두께
      });

      mount.classList.remove('fx-burst');
      void mount.offsetWidth;          // 이 한 줄이 애니메이션을 처음부터 다시 돌게 한다
      mount.classList.add('fx-burst');

      setTimeout(() => mount.classList.remove('fx-burst'), FX.BURST_SEC * 1000);
    }

    function schedule(){
      if(noMotion) return;             // 움직임 최소화를 켠 사람에겐 안 터뜨린다
      clearTimeout(timer);
      const gap = FX.BURST_MIN + Math.random() * Math.max(0, FX.BURST_MAX - FX.BURST_MIN);
      timer = setTimeout(() => { burst(); schedule(); }, gap * 1000);
    }
    schedule();

    /* 콘솔에서 fxBurst() 치면 바로 한 번 터진다. 값 맞출 때 쓸 것 */
    window.fxBurst = burst;
  }

  /* 이 파일을 <head> 에 넣어도 돌아가게 해둔다 */
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', start);
  }else{
    start();
  }

})();
