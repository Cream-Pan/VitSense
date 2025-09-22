// === MAX & MLX 4デバイス統合 Web Bluetooth アプリ ===

// ===== MAX30102 側定数（UUIDは従来どおり） =====
const MAX_SERVICE_UUID = "3a5197ff-07ce-499e-8d37-d3d457af549a";
const MAX_CHARACTERISTIC_UUID = "abcdef01-1234-5678-1234-56789abcdef0"; // float32 BPM + uint32 elapsed
const MAX_FLAG_CHARACTERISTIC_UUID = "abcdef01-1234-5678-1234-56789abcdef1"; // uint8 flag (0/1)

// ===== MLX90632 側定数 =====
const MLX_SERVICE_UUID = "4a5197ff-07ce-499e-8d37-d3d457af549a";
const MLX_CHARACTERISTIC_UUID = "fedcba98-7654-3210-fedc-ba9876543210"; // float32 amb + float32 obj + uint32 elapsed

// ===== デバイス名（Arduino側で設定） =====
const DEVICE_NAMES = {
  MAX: { R: "MAX R", L: "MAX L" },
  MLX: { R: "MLX R", L: "MLX L" }
};

// 共通ユーティリティ
function pad(n, w = 2) { return String(n).padStart(w, "0"); }
function formatLocalTimeWithMs(epochMs) {
  const d = new Date(epochMs);
  return `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(),3)}`;
}
function formatLocalTimeForCSV(epochMs) {
  const d = new Date(epochMs);
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  const seconds = pad(d.getSeconds());
  const milliseconds = pad(d.getMilliseconds(), 3);
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}`;
}

// チャート作成
function makeLineChart(ctx, yTitle, datasets) {
  return new Chart(ctx, {
    type: "line",
    data: { labels: [], datasets },
    options: {
      responsive: true,
      animation: { duration: 0 },
      scales: {
        x: { type: "linear", title: { display: true, text: "経過時間 (s)" } },
        y: { beginAtZero: false, title: { display: true, text: yTitle } }
      }
    }
  });
}

// ===== MAX ユニットファクトリ =====
function createMAXUnit(side) {
  const prefix = side === 'R' ? 'maxR' : 'maxL';
  const els = {
    connect: document.getElementById(`${prefix}-connect`),
    disconnect: document.getElementById(`${prefix}-disconnect`),
    status: document.getElementById(`${prefix}-status`),
    deviceName: document.getElementById(`${prefix}-deviceName`),
    bpm: document.getElementById(`${prefix}-bpmValue`),
    avg: document.getElementById(`${prefix}-avgBpmValue`),
    time: document.getElementById(`${prefix}-timeValue`),
    recv: document.getElementById(`${prefix}-recvTimeValue`),
    distance: document.getElementById(`${prefix}-distanceStatus`),
  };
  return {
    side,
    device: null, service: null, ch: null, flagCh: null,
    measureStartEpochMs: null,
    bpmBuffer: [], RATE_SIZE: 4,
    receivedData: [],
    connected: false,
    els,
    resetView(){
      this.receivedData.length = 0;
      this.bpmBuffer = [];
      this.els.bpm.textContent = "-";
      this.els.avg.textContent = "-";
      this.els.time.textContent = "-";
      this.els.recv.textContent = "-";
      this.els.distance.textContent = "-";
      this.measureStartEpochMs = null;
    },
    notifyHandler: function(event){
      const v = event.target.value; if(v.byteLength!==8) return;
      const recvEpochMs = Date.now();
      const bpm = v.getFloat32(0,true);
      const sensorElapsedMs = v.getUint32(4,true);
      const sensorElapsedS = sensorElapsedMs/1000;
      this.bpmBuffer.push(bpm); if(this.bpmBuffer.length>this.RATE_SIZE) this.bpmBuffer.shift();
      const beatAvg = this.bpmBuffer.reduce((a,b)=>a+b,0)/this.bpmBuffer.length;
      const measureElapsedS = this.measureStartEpochMs ? (recvEpochMs - this.measureStartEpochMs)/1000 : 0;
      this.els.bpm.textContent = bpm.toFixed(2);
      this.els.avg.textContent = isFinite(beatAvg)? beatAvg.toFixed(2):"-";
      this.els.time.textContent = measureElapsedS.toFixed(2);
      this.els.recv.textContent = formatLocalTimeWithMs(recvEpochMs);
      this.receivedData.push({ bpm, beatAvg, sensor_elapsed_ms:sensorElapsedMs, sensor_elapsed_s:sensorElapsedS,
        measure_elapsed_s:measureElapsedS, recv_epoch_ms:recvEpochMs, recv_jst: formatLocalTimeForCSV(recvEpochMs) });
      // チャート更新はグローバルで行う
      updateMAXChart(this.side, bpm, measureElapsedS);
    },
    flagHandler: function(event){
      const v = event.target.value; if(v.byteLength!==1) return;
      const flag = v.getUint8(0);
      if(flag===0){ this.els.distance.textContent="センサとの距離が離れています"; this.els.distance.style.color="#d00"; this.els.distance.style.fontWeight="600"; }
      else { this.els.distance.textContent="距離は正常です"; this.els.distance.style.color="#046307"; this.els.distance.style.fontWeight="600"; }
    },
  };
}

// ===== MLX ユニットファクトリ =====
function createMLXUnit(side){
  const prefix = side === 'R' ? 'mlxR' : 'mlxL';
  const els = {
    connect: document.getElementById(`${prefix}-connect`),
    disconnect: document.getElementById(`${prefix}-disconnect`),
    status: document.getElementById(`${prefix}-status`),
    deviceName: document.getElementById(`${prefix}-deviceName`),
    amb: document.getElementById(`${prefix}-ambValue`),
    obj: document.getElementById(`${prefix}-objValue`),
    time: document.getElementById(`${prefix}-timeValue`),
    recv: document.getElementById(`${prefix}-recvTimeValue`),
  };
  return {
    side,
    device:null, service:null, ch:null,
    measureStartEpochMs:null,
    receivedData:[],
    latestSample:null,
    connected:false,
    els,
    resetView(){
      this.receivedData.length = 0;
      this.latestSample = null;
      this.els.amb.textContent = "-";
      this.els.obj.textContent = "-";
      this.els.time.textContent = "-";
      this.els.recv.textContent = "-";
      this.measureStartEpochMs = null;
    },
    notifyHandler:function(event){
      const v=event.target.value; if(v.byteLength!==12) return;
      const recvEpochMs=Date.now();
      const amb=v.getFloat32(0,true); const obj=v.getFloat32(4,true);
      const sensorElapsedMs=v.getUint32(8,true);
      this.latestSample = { amb, obj, sensorElapsedMs, recvEpochMs };
    },
    processLatestSample: function(){
      if(!this.latestSample) return;
      const {amb,obj,sensorElapsedMs,recvEpochMs} = this.latestSample;
      const sensorElapsedS = sensorElapsedMs/1000;
      const measureElapsedS = this.measureStartEpochMs ? (recvEpochMs - this.measureStartEpochMs)/1000 : 0;
      this.els.amb.textContent = amb.toFixed(4);
      this.els.obj.textContent = obj.toFixed(4);
      this.els.time.textContent = measureElapsedS.toFixed(2);
      this.els.recv.textContent = formatLocalTimeWithMs(recvEpochMs);
      this.receivedData.push({ amb, obj, sensor_elapsed_ms:sensorElapsedMs, sensor_elapsed_s:sensorElapsedS,
        measure_elapsed_s:measureElapsedS, recv_epoch_ms:recvEpochMs, recv_jst: formatLocalTimeForCSV(recvEpochMs) });
      updateMLXChart(this.side, obj, measureElapsedS);
    }
  };
}

// ===== グローバル状態 =====
const MAX_R = createMAXUnit('R');
const MAX_L = createMAXUnit('L');
const MLX_R = createMLXUnit('R');
const MLX_L = createMLXUnit('L');

const measureAllBtn = document.getElementById("measure-all");
const downloadAllBtn = document.getElementById("download-all");
let measuring = false;
let mlxIntervalId = null; // MLXのUI反映タイマー（両方一括）

// ===== チャート（MAX: BPM R/L，MLX: Object R/L） =====
let maxChart = null;
let mlxChart = null;
function ensureCharts(){
  if(!maxChart){
    const ctxMax = document.getElementById("max-realtimeChart").getContext("2d");
    maxChart = makeLineChart(ctxMax, "BPM", [
      { label: "BPM R", data: [], borderWidth: 2, borderColor: "rgb(75, 192, 192)", fill:false, pointRadius:0, tension:0.2 },
      { label: "BPM L", data: [], borderWidth: 2, borderColor: "rgb(255, 99, 132)", fill:false, pointRadius:0, tension:0.2 },
    ]);
  }
  if(!mlxChart){
    const ctxMlx = document.getElementById("mlx-realtimeChart").getContext("2d");
    mlxChart = makeLineChart(ctxMlx, "Object 温度 (°C)", [
      { label: "Obj R (°C)", data: [], borderWidth: 2, borderColor: "rgb(75, 192, 192)", fill:false, pointRadius:0, tension:0.2 },
      { label: "Obj L (°C)", data: [], borderWidth: 2, borderColor: "rgb(255, 99, 132)", fill:false, pointRadius:0, tension:0.2 },
    ]);
  }
}
function updateMAXChart(side, value, elapsedS){
  ensureCharts();
  const dsR = maxChart.data.datasets[0];
  const dsL = maxChart.data.datasets[1];
  const pushPoint = (dataset, x, y)=>{ dataset.data.push({x, y}); };
  const maxPts = 50;
  if(side==='R') pushPoint(dsR, elapsedS, value); else pushPoint(dsL, elapsedS, value);
  // 各系列ごとに点数を制限
  if(dsR.data.length>maxPts) dsR.data.shift();
  if(dsL.data.length>maxPts) dsL.data.shift();
  maxChart.update('none');
}
function updateMLXChart(side, objValue, elapsedS){
  ensureCharts();
  const labels = mlxChart.data.labels;
  const dsR = mlxChart.data.datasets[0];
  const dsL = mlxChart.data.datasets[1];
  const maxPts = 50;
  if(side==='R') dsR.data.push({x: elapsedS, y: objValue});
  else  dsL.data.push({x: elapsedS, y: objValue});
  if(dsR.data.length>maxPts) dsR.data.shift();
  if(dsL.data.length>maxPts) dsL.data.shift();
  mlxChart.update('none');
}
function resetCharts(){
  if(maxChart){ maxChart.data.labels=[]; maxChart.data.datasets.forEach(d=>d.data=[]); maxChart.update(); }
  if(mlxChart){ mlxChart.data.labels=[]; mlxChart.data.datasets.forEach(d=>d.data=[]); mlxChart.update(); }
}

// ===== 統一ボタンと状態管理 =====
function allConnected(){
  return MAX_R.connected && MAX_L.connected && MLX_R.connected && MLX_L.connected;
}
function anyDataExists(){
  return MAX_R.receivedData.length || MAX_L.receivedData.length || MLX_R.receivedData.length || MLX_L.receivedData.length;
}
function updateUnifiedButtons(){
  measureAllBtn.disabled = !allConnected();
  downloadAllBtn.disabled = !anyDataExists();
  measureAllBtn.textContent = measuring ? "計測停止" : "計測開始";
}

// ===== 接続/切断 ハンドラ =====
async function connectMAX(unit){
  try{
    unit.els.status.textContent = "接続中...";
    unit.device = await navigator.bluetooth.requestDevice({ filters:[{ name: DEVICE_NAMES.MAX[unit.side] }], optionalServices:[MAX_SERVICE_UUID] });
    const server = await unit.device.gatt.connect();
    unit.service = await server.getPrimaryService(MAX_SERVICE_UUID);
    unit.ch = await unit.service.getCharacteristic(MAX_CHARACTERISTIC_UUID);
    unit.flagCh = await unit.service.getCharacteristic(MAX_FLAG_CHARACTERISTIC_UUID);
    unit.connected = true;
    unit.els.status.textContent = "接続済み"; unit.els.deviceName.textContent = unit.device.name;
    unit.els.connect.disabled = true; unit.els.disconnect.disabled = false; // 計測開始までは切断不可にせずとも可
    unit.device.addEventListener("gattserverdisconnected", ()=>{
      try{ unit.ch?.removeEventListener("characteristicvaluechanged", unit.notifyHandler);}catch{}
      try{ unit.flagCh?.removeEventListener("characteristicvaluechanged", unit.flagHandler);}catch{}
      unit.connected=false; unit.els.status.textContent="未接続"; unit.els.deviceName.textContent="-";
      unit.els.connect.disabled=false; unit.els.disconnect.disabled=true;
      if(measuring) stopMeasurementAll();
      unit.resetView(); updateUnifiedButtons();
    });
  }catch(e){
    console.error("MAX 接続エラー:", e);
    alert(`MAX ${unit.side} への接続に失敗しました．`);
    unit.connected=false; unit.els.status.textContent="未接続"; unit.els.deviceName.textContent="-";
    unit.els.connect.disabled=false; unit.els.disconnect.disabled=true;
  } finally { updateUnifiedButtons(); }
}
async function disconnectMAX(unit){
  try{
    if(unit.device?.gatt.connected){
      if(measuring){ await unit.ch.stopNotifications().catch(()=>{}); await unit.flagCh.stopNotifications().catch(()=>{}); }
      unit.device.gatt.disconnect();
    }
  }catch{}
}
async function connectMLX(unit){
  try{
    unit.els.status.textContent = "接続中...";
    unit.device = await navigator.bluetooth.requestDevice({ filters:[{ name: DEVICE_NAMES.MLX[unit.side] }], optionalServices:[MLX_SERVICE_UUID] });
    const server = await unit.device.gatt.connect();
    unit.service = await server.getPrimaryService(MLX_SERVICE_UUID);
    unit.ch = await unit.service.getCharacteristic(MLX_CHARACTERISTIC_UUID);
    unit.connected = true;
    unit.els.status.textContent = "接続済み"; unit.els.deviceName.textContent = unit.device.name;
    unit.els.connect.disabled = true; unit.els.disconnect.disabled = false;
    unit.device.addEventListener("gattserverdisconnected", ()=>{
      try{ unit.ch?.removeEventListener("characteristicvaluechanged", unit.notifyHandler);}catch{}
      unit.connected=false; unit.els.status.textContent="未接続"; unit.els.deviceName.textContent="-";
      unit.els.connect.disabled=false; unit.els.disconnect.disabled=true;
      if(measuring) stopMeasurementAll();
      unit.resetView(); updateUnifiedButtons();
    });
  }catch(e){
    console.error("MLX 接続エラー:", e);
    alert(`MLX ${unit.side} への接続に失敗しました．`);
    unit.connected=false; unit.els.status.textContent="未接続"; unit.els.deviceName.textContent="-";
    unit.els.connect.disabled=false; unit.els.disconnect.disabled=true;
  } finally { updateUnifiedButtons(); }
}
async function disconnectMLX(unit){
  try{
    if(unit.device?.gatt.connected){
      if(measuring){ await unit.ch.stopNotifications().catch(()=>{}); }
      unit.device.gatt.disconnect();
    }
  }catch{}
}

// ボタン割当
MAX_R.els.connect.addEventListener('click', ()=>connectMAX(MAX_R));
MAX_L.els.connect.addEventListener('click', ()=>connectMAX(MAX_L));
MAX_R.els.disconnect.addEventListener('click', ()=>disconnectMAX(MAX_R));
MAX_L.els.disconnect.addEventListener('click', ()=>disconnectMAX(MAX_L));
MLX_R.els.connect.addEventListener('click', ()=>connectMLX(MLX_R));
MLX_L.els.connect.addEventListener('click', ()=>connectMLX(MLX_L));
MLX_R.els.disconnect.addEventListener('click', ()=>disconnectMLX(MLX_R));
MLX_L.els.disconnect.addEventListener('click', ()=>disconnectMLX(MLX_L));

// ===== 計測の開始／停止（統一） =====
async function startMeasurementAll(){
  // チャート＆ビュー初期化
  [MAX_R, MAX_L, MLX_R, MLX_L].forEach(u=>u.resetView());
  resetCharts(); ensureCharts();

  // MAX開始
  for(const u of [MAX_R, MAX_L]){
    if(!u._bound){
     u._notifyHandlerBound = u.notifyHandler.bind(u);
     u._flagHandlerBound   = u.flagHandler.bind(u);
     u._bound = true;
   }
   try{ u.ch?.removeEventListener("characteristicvaluechanged", u._notifyHandlerBound);}catch{}
   try{ u.flagCh?.removeEventListener("characteristicvaluechanged", u._flagHandlerBound);}catch{}
   u.ch.addEventListener("characteristicvaluechanged", u._notifyHandlerBound);
   u.flagCh.addEventListener("characteristicvaluechanged", u._flagHandlerBound);
    await u.ch.startNotifications();
    await u.flagCh.startNotifications();
    u.measureStartEpochMs = Date.now();
  }
  // MLX開始
  for(const u of [MLX_R, MLX_L]){
    if(!u._bound){
      u._notifyHandlerBound = u.notifyHandler.bind(u);
      u._bound = true;
   }
   try{ u.ch?.removeEventListener("characteristicvaluechanged", u._notifyHandlerBound);}catch{}
   u.ch.addEventListener("characteristicvaluechanged", u._notifyHandlerBound);
    await u.ch.startNotifications();
    u.measureStartEpochMs = Date.now();
  }
  // MLXのUI反映（1Hz）
  mlxIntervalId = setInterval(()=>{
    MLX_R.processLatestSample();
    MLX_L.processLatestSample();
  }, 1000);

  measuring = true; updateUnifiedButtons();
}

async function stopMeasurementAll(){
  // MAX停止
  for(const u of [MAX_R, MAX_L]){
    try{ await u.ch.stopNotifications(); }catch{}
    try{ await u.flagCh.stopNotifications(); }catch{}
    try{ u.ch?.removeEventListener("characteristicvaluechanged", u._notifyHandlerBound);}catch{}
    try{ u.flagCh?.removeEventListener("characteristicvaluechanged", u._flagHandlerBound);}catch{}
    u.measureStartEpochMs = null;
  }
  // MLX停止
  for(const u of [MLX_R, MLX_L]){
    try{ await u.ch.stopNotifications(); }catch{}
    try{ u.ch?.removeEventListener("characteristicvaluechanged", u._notifyHandlerBound);}catch{}
    u.measureStartEpochMs = null;
  }
  if(mlxIntervalId){ clearInterval(mlxIntervalId); mlxIntervalId=null; }
  measuring = false; updateUnifiedButtons();
}

measureAllBtn.addEventListener("click", async ()=>{
  if(!allConnected()) return;
  if(measuring) await stopMeasurementAll(); else {
    try{ await startMeasurementAll(); }
    catch(e){ console.error("統一計測開始エラー:", e); await stopMeasurementAll(); alert("計測開始に失敗しました．4台の接続を確認してください．"); }
  }
});

// ===== 一括ダウンロード（Excelブック：4シート） =====
function appendSheetFromJson(wb, name, rows){
  if(rows.length>0){
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }else{
    const ws = XLSX.utils.aoa_to_sheet([["データなし"]]);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
}
downloadAllBtn.addEventListener("click", ()=>{
  const wb = XLSX.utils.book_new();
  // MAX R
  appendSheetFromJson(wb, "MAX_R", MAX_R.receivedData.map(r=>({
    BPM: r.bpm, Avg_BPM: r.beatAvg,
    SensorElapsed_ms: r.sensor_elapsed_ms, SensorElapsed_s: r.sensor_elapsed_s,
    MeasureElapsed_s: r.measure_elapsed_s,
    RecvEpoch_ms: r.recv_epoch_ms, RecvJST: r.recv_jst
  })));
  // MAX L
  appendSheetFromJson(wb, "MAX_L", MAX_L.receivedData.map(r=>({
    BPM: r.bpm, Avg_BPM: r.beatAvg,
    SensorElapsed_ms: r.sensor_elapsed_ms, SensorElapsed_s: r.sensor_elapsed_s,
    MeasureElapsed_s: r.measure_elapsed_s,
    RecvEpoch_ms: r.recv_epoch_ms, RecvJST: r.recv_jst
  })));
  // MLX R
  appendSheetFromJson(wb, "MLX_R", MLX_R.receivedData.map(r=>({
    Ambient_C: r.amb, Object_C: r.obj,
    SensorElapsed_ms: r.sensor_elapsed_ms, SensorElapsed_s: r.sensor_elapsed_s,
    MeasureElapsed_s: r.measure_elapsed_s,
    RecvEpoch_ms: r.recv_epoch_ms, RecvJST: r.recv_jst
  })));
  // MLX L
  appendSheetFromJson(wb, "MLX_L", MLX_L.receivedData.map(r=>({
    Ambient_C: r.amb, Object_C: r.obj,
    SensorElapsed_ms: r.sensor_elapsed_ms, SensorElapsed_s: r.sensor_elapsed_s,
    MeasureElapsed_s: r.measure_elapsed_s,
    RecvEpoch_ms: r.recv_epoch_ms, RecvJST: r.recv_jst
  })));

  const filename = "MAX_MLX_4devices_measurement.xlsx";
  XLSX.writeFile(wb, filename);
});

// 初期化
updateUnifiedButtons();