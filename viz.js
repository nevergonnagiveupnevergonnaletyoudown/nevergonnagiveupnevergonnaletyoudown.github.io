/* =========================================================
   NV — 오디오 비주얼라이저

   재생 중인 소리의 주파수를 뽑아서 막대로 그린다.
   fx.js 와 같은 방식: 숫자는 전부 아래 VIZ 한 덩어리에 모여 있다.

   ★ 쓰는 법 (songs.html 맨 아래에서)
       NVViz.attach(audio, document.getElementById('viz'));
     첫 번째는 소리를 내는 Audio 객체, 두 번째는 그림을 그릴 <canvas>.

   ★ 이 파일은 defer 를 붙이면 안 된다.
     defer 를 붙이면 페이지 아래쪽 <script> 가 먼저 돌아서
     그 시점엔 아직 NVViz 가 없다 → "NVViz is not defined" 에러.
   ========================================================= */

const VIZ = {
  BARS: 44,          // 막대 개수
  GAP: 2,            // 막대 사이 간격(px)
  GLOW: 6,           // 막대 번짐 정도(px). 0 이면 끔 — 느리면 여기부터 0으로

  FFT: 2048,         // 주파수를 몇 칸으로 쪼갤지. 2의 거듭제곱만 가능
  SMOOTH: 0.66,      // 부드럽기(0~1). 높을수록 느긋하게 움직인다
  MIN_DB: -62,       // 이 크기보다 작은 소리는 바닥 취급
  MAX_DB: -10,       // 이 크기면 막대가 꽉 참. 막대가 계속 천장이면 숫자를 올린다

  /* ★ 언덕 모양을 뾰족하게 만드는 값.
     1 이면 정직하게 그린다 = 완만한 언덕.
     키울수록 낮은 건 더 낮게, 높은 건 그대로 둬서 골짜기가 깊어진다.
     2.5 를 넘으면 조용한 부분이 아예 안 보인다. */
  GAMMA: 1.7,

  /* 막대 하나가 담당하는 구간에서 최댓값을 얼마나 쓸지.
     1 = 최댓값만 (오른쪽 막대가 넓은 구간을 맡아서 항상 부풀어오름)
     0 = 평균만 (밋밋해짐)
     그 사이를 섞는다. */
  PEAKY: 0.55,

  F_MIN: 45,         // 왼쪽 끝이 담당하는 주파수(Hz)
  F_MAX: 15000,      // 오른쪽 끝이 담당하는 주파수(Hz)
  TILT: 0.28,        // 고음 보정. 고음은 원래 에너지가 작아서 안 올라온다

  PEAK_FALL: 0.55,   // 피크 표시가 1초에 얼마나 내려오는지 (1 = 화면 높이 전부)
  IDLE_FALL: 1.8,    // 정지했을 때 막대가 주저앉는 속도
  HOT: 0.88          // 이 높이를 넘으면 색이 바뀜 (막대→밝은 초록, 피크→주황)
};


window.NVViz = (function(){

  let audioEl = null;     // 소리 내는 Audio 객체
  let canvas  = null;     // 그림 그릴 캔버스
  let cvs     = null;     // 캔버스의 붓

  let ctx = null;         // AudioContext — 소리를 다루는 작업대
  let analyser = null;    // 주파수를 재주는 장치
  let bins = null;        // 주파수 측정값이 담기는 배열

  let ranges = [];        // 막대 하나가 담당하는 측정값 구간
  let vals = [];          // 지금 막대 높이 (0~1)
  let peaks = [];         // 피크 표시 높이 (0~1)

  let raf = 0;            // 화면 갱신 예약 번호
  let last = 0;           // 직전 프레임 시각
  let W = 0, H = 0;       // 캔버스 크기(px)
  let color = {};


  /* ---------- style.css 의 색을 그대로 읽어온다 ----------
     색을 바꾸고 싶으면 이 파일이 아니라 style.css 의 :root 만 고치면 된다. */
  function readColors(){
    const cs = getComputedStyle(document.documentElement);
    const get = (n, fallback) =>
      (cs.getPropertyValue(n).trim() || fallback);

    color = {
      phos : get('--phos',     '#2CFF88'),
      mid  : get('--phos-mid', '#17B85F'),
      dim  : get('--phos-dim', '#0C7A3E'),
      amber: get('--amber',    '#FFB63C')
    };
  }


  /* ---------- 캔버스 해상도 맞추기 ----------
     CSS 로 정한 크기와 실제 픽셀 수는 다르다.
     이걸 안 맞추면 고해상도 화면에서 뿌옇게 보인다. */
  function resize(){
    if(!canvas) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const box = canvas.getBoundingClientRect();

    W = Math.max(1, Math.round(box.width));
    H = Math.max(1, Math.round(box.height));

    canvas.width  = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);

    cvs.setTransform(dpr, 0, 0, dpr, 0, 0);
    if(!raf) drawIdle();
  }


  /* ---------- 막대별 담당 주파수 구간 계산 ----------
     그냥 균등하게 나누면 저음이 왼쪽 한두 칸에 전부 몰린다.
     사람 귀는 로그로 듣기 때문에 구간도 로그로 넓혀간다. */
  function buildRanges(){
    const nyq = ctx.sampleRate / 2;       // 측정 가능한 최고 주파수
    const n   = analyser.frequencyBinCount;

    ranges = [];
    for(let i = 0; i < VIZ.BARS; i++){
      const f0 = VIZ.F_MIN * Math.pow(VIZ.F_MAX / VIZ.F_MIN,  i      / VIZ.BARS);
      const f1 = VIZ.F_MIN * Math.pow(VIZ.F_MAX / VIZ.F_MIN, (i + 1) / VIZ.BARS);

      let a = Math.floor(f0 / nyq * n);
      let b = Math.ceil (f1 / nyq * n);

      a = Math.min(n - 1, Math.max(0, a));
      b = Math.min(n, Math.max(a + 1, b));

      ranges.push([a, b]);
    }

    vals  = new Array(VIZ.BARS).fill(0);
    peaks = new Array(VIZ.BARS).fill(0);
  }


  /* ---------- 오디오 배선 ----------
     ★ 여기가 이 파일에서 제일 중요한 부분이다.

     createMediaElementSource 를 부르는 순간
     소리가 스피커로 바로 가던 길이 끊기고 이 작업대로 끌려온다.
     그래서 analyser.connect(ctx.destination) 로 다시 스피커에
     이어주지 않으면 화면만 움직이고 소리가 안 난다.

     그리고 이 함수는 Audio 객체 하나당 딱 한 번만 부를 수 있다.
     두 번 부르면 에러가 난다. (ctx 가 있으면 바로 빠져나가는 이유) */
  function wireAudio(){
    if(ctx) return true;

    const AC = window.AudioContext || window.webkitAudioContext;
    if(!AC) return false;               // 아주 오래된 브라우저

    try{
      ctx = new AC();

      analyser = ctx.createAnalyser();
      analyser.fftSize = VIZ.FFT;
      analyser.smoothingTimeConstant = VIZ.SMOOTH;
      analyser.minDecibels = VIZ.MIN_DB;
      analyser.maxDecibels = VIZ.MAX_DB;

      ctx.createMediaElementSource(audioEl).connect(analyser);
      analyser.connect(ctx.destination);   // ★ 이 줄이 없으면 무음

      bins = new Uint8Array(analyser.frequencyBinCount);
      buildRanges();
      return true;

    }catch(e){
      /* 실패해도 음악은 그대로 나와야 한다.
         ctx 를 비워두면 다음부터는 조용히 안 그리고 넘어간다. */
      ctx = null;
      analyser = null;
      return false;
    }
  }


  /* ---------- 아무것도 안 나올 때: 바닥선만 ---------- */
  function drawIdle(){
    if(!cvs) return;
    cvs.clearRect(0, 0, W, H);
    cvs.shadowBlur = 0;
    cvs.fillStyle = color.dim;
    cvs.fillRect(0, H - 1, W, 1);
  }


  /* ---------- 매 프레임 그리기 ---------- */
  function frame(now){
    /* 지난 프레임에서 몇 초가 흘렀는지.
       프레임 수로 세면 화면 주사율(60Hz/144Hz)에 따라 속도가 달라진다.
       실제 시간으로 세야 어디서든 똑같이 움직인다. */
    let dt = (now - last) / 1000;
    if(!(dt > 0) || dt > 0.1) dt = 1 / 60;
    last = now;

    const playing = !audioEl.paused && !audioEl.ended;
    if(playing && analyser) analyser.getByteFrequencyData(bins);

    cvs.clearRect(0, 0, W, H);

    const bw = (W - VIZ.GAP * (VIZ.BARS - 1)) / VIZ.BARS;
    let awake = false;

    for(let i = 0; i < VIZ.BARS; i++){
      let v = 0;

      if(playing && analyser){
        /* 담당 구간의 최댓값과 평균을 둘 다 구해서 섞는다.
           최댓값만 쓰면 구간이 넓은 오른쪽 막대가 항상 부풀고,
           평균만 쓰면 전체가 밋밋해진다. */
        const [a, b] = ranges[i];
        let mx = 0, sum = 0;
        for(let k = a; k < b; k++){
          const s = bins[k];
          if(s > mx) mx = s;
          sum += s;
        }
        const avg = sum / (b - a);

        v = (avg + (mx - avg) * VIZ.PEAKY) / 255;
        v = v * (1 + VIZ.TILT * (i / (VIZ.BARS - 1)));   // 고음 보정
        if(v > 1) v = 1;

        // 대비 강조: 낮은 건 더 낮게 눌러서 골짜기를 판다
        v = Math.pow(v, VIZ.GAMMA);

        vals[i] = v;
      }else{
        /* 멈췄으면 천천히 주저앉는다 */
        vals[i] = Math.max(0, vals[i] - VIZ.IDLE_FALL * dt);
        v = vals[i];
      }

      // 피크: 올라갈 땐 즉시, 내려올 땐 천천히
      peaks[i] = Math.max(v, peaks[i] - VIZ.PEAK_FALL * dt);
      if(v > 0.002 || peaks[i] > 0.002) awake = true;

      const x = i * (bw + VIZ.GAP);

      // 막대
      if(v > 0.002){
        const h = Math.max(1, v * H);
        cvs.shadowBlur = VIZ.GLOW;
        cvs.shadowColor = color.phos;
        cvs.fillStyle = (v > VIZ.HOT) ? color.phos : color.mid;
        cvs.fillRect(x, H - h, bw, h);
      }

      // 피크 표시 (막대 위에 떠 있는 짧은 선)
      if(peaks[i] > 0.01){
        const ph = Math.max(2, peaks[i] * H);
        const hot = peaks[i] > VIZ.HOT;
        cvs.shadowBlur = VIZ.GLOW;
        cvs.shadowColor = hot ? color.amber : color.phos;
        cvs.fillStyle   = hot ? color.amber : color.phos;
        cvs.fillRect(x, H - ph, bw, 2);
      }
    }

    // 바닥선
    cvs.shadowBlur = 0;
    cvs.fillStyle = color.dim;
    cvs.fillRect(0, H - 1, W, 1);

    /* 멈췄고 전부 주저앉았으면 그리기를 접는다.
       계속 돌려봐야 배터리만 먹는다. */
    if(!playing && !awake){
      raf = 0;
      drawIdle();
      return;
    }
    raf = requestAnimationFrame(frame);
  }


  function run(){
    if(raf) return;                    // 이미 돌고 있으면 그냥 둔다
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }


  /* ---------- 바깥에서 부르는 함수 ---------- */
  function attach(a, c){
    audioEl = a;
    canvas  = c;
    if(!audioEl || !canvas) return;    // 하나라도 없으면 조용히 끝

    cvs = canvas.getContext('2d');
    readColors();
    resize();

    window.addEventListener('resize', resize);

    audioEl.addEventListener('play', () => {
      wireAudio();
      /* 브라우저는 사용자가 뭔가 누르기 전에는 소리 작업대를 재워둔다.
         재생 버튼을 눌렀다는 건 이미 눌렀다는 뜻이니 여기서 깨운다. */
      if(ctx && ctx.state === 'suspended') ctx.resume();
      run();
    });

    // 일시정지/종료돼도 주저앉는 모습은 보여줘야 하니 계속 돌린다
    audioEl.addEventListener('pause', run);
    audioEl.addEventListener('ended', run);
  }

  return { attach };

})();
