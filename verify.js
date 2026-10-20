/*
 * 打卡页核心逻辑自检脚本
 * 用法: node verify.js
 * 直接从 index.html 里抽出真实脚本执行，测的是页面真正跑的代码，不是副本。
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('没找到 script 块'); process.exit(1); }
const code = m[1];

// ---- 最小 DOM / 浏览器环境桩 ----
const mkEl = () => ({
  innerHTML: '', value: '', textContent: '', style: {},
  onclick: null, getAttribute: () => '', scrollIntoView() {}, select() {}, focus() {}
});
const document = {
  getElementById: () => mkEl(),
  querySelectorAll: () => [],
  createElement: () => mkEl(),
  body: { appendChild() {}, removeChild() {} },
  execCommand: () => true
};
const window = { addEventListener() {}, scrollTo() {} };
const location = { hash: '', origin: 'https://example.com', pathname: '/index.html' };
const localStorage = {
  _d: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; }
};
const navigator = {};

const ctx = vm.createContext({
  document, window, location, localStorage, navigator,
  TextEncoder, TextDecoder, btoa, atob,
  fetch: () => Promise.reject(new Error('no net in test')),
  setTimeout: () => 0, clearTimeout: () => {}, console, JSON, Date, Math, Object, Array, String, Number, RegExp, Error
});

vm.runInContext(code, ctx, { filename: 'index.html<script>' });
const CC = ctx.window.__CC__;
if (!CC) { console.error('未拿到导出对象'); process.exit(1); }

// ---- 断言 ----
let pass = 0, fail = 0;
function eq(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + '  得到 ' + g + '  期望 ' + w); }
}

console.log('\n[1] 日期归一化 normDate');
eq('标准 2026-10-20', CC.normDate('2026-10-20'), '2026-10-20');
eq('斜杠 2026/10/20', CC.normDate('2026/10/20'), '2026-10-20');
eq('带时间 2026-10-20 10:11:12', CC.normDate('2026-10-20 10:11:12'), '2026-10-20');
eq('单位数补零 2026-1-5', CC.normDate('2026-1-5'), '2026-01-05');
eq('空串', CC.normDate(''), '');
eq('乱码 abc', CC.normDate('abc'), '');
eq('null', CC.normDate(null), '');

console.log('\n[2] 连续打卡天数 streak');
const T = CC.today(), Y1 = CC.daysAgo(1), Y2 = CC.daysAgo(2), Y3 = CC.daysAgo(3);
eq('今天+昨天+前天 => 3', CC.streak({ [T]:1, [Y1]:1, [Y2]:1 }), 3);
eq('今天没打 昨天+前天 => 2', CC.streak({ [Y1]:1, [Y2]:1 }), 2);
eq('昨天断了 只有前天+大前天 => 0', CC.streak({ [Y2]:1, [Y3]:1 }), 0);
eq('空 => 0', CC.streak({}), 0);
eq('只有今天 => 1', CC.streak({ [T]:1 }), 1);

console.log('\n[3] 数据解析 parseRows');
eq('标准数组', CC.parseRows('[{"name":"张三","type":"读书","date":"2026-10-20"}]'),
   [{ name:'张三', type:'读书', date:'2026-10-20', note:'' }]);
eq('中文键名', CC.parseRows('[{"姓名":"李四","打卡类型":"学习经典一课"}]').map(r => r.name), ['李四']);
eq('大写键名兼容', CC.parseRows('[{"Name":"王五","Type":"跑步"}]').map(r => r.name), ['王五']);
eq('data 包裹', CC.parseRows('{"data":[{"name":"赵六"}]}').map(r => r.name), ['赵六']);
eq('空数组', CC.parseRows('[]'), []);
eq('非法 JSON', CC.parseRows('not json'), []);
eq('缺姓名被丢弃', CC.parseRows('[{"type":"读书"}]'), []);

console.log('\n[4] 配置编解码（含中文往返）');
const cfg = { org:'118 创造营', title:'每日打卡', members:'张三\n李四\n王五', types:'读书\n学习经典一课' };
const back = CC.decCfg(CC.encCfg(cfg));
eq('中文往返一致', back, cfg);

console.log('\n[5] 统计 build');
const rows = [
  { name:'张三', type:'读书', date:T,  note:'读了 32 页' },
  { name:'张三', type:'读书', date:Y1, note:'' },
  { name:'李四', type:'学习经典一课', date:T, note:'' }
];
const map = CC.build(rows);
eq('张三今日已打卡', map['张三'].done, true);
eq('张三连续 2 天', map['张三'].streak, 2);
eq('张三累计 2 次', map['张三'].total, 2);
eq('张三今日类型', map['张三'].todayTypes, ['读书']);
eq('张三最新心得', map['张三'].note, '读了 32 页');
eq('李四今日已打卡', map['李四'].done, true);
eq('李四连续 1 天', map['李四'].streak, 1);
eq('周八未打卡', map['周八'], undefined);

console.log('\n[6] 姓名清洗 clean');
eq('去空格', CC.clean(' 张 三 '), '张三');
eq('空值', CC.clean(null), '');

console.log('\n[7] 页面渲染 renderHome（真实模板，不白屏检查）');
const cfg2 = {
  org:'118 创造营', title:'每日打卡', surveyUrl:'https://www.wjx.cn/vm/test.aspx',
  dataUrl:'https://x/data', proxy:'',
  members:'张三\n李四\n周八', types:'读书\n学习经典一课', manual:''
};
const rows2 = [
  { name:'张三', type:'读书', date:T, note:'读了 32 页' },
  { name:'李四', type:'学习经典一课', date:T, note:'' }
];
const home = CC.renderHome(cfg2, { ok:true, rows:rows2 });
eq('渲染出组织名', home.indexOf('118 创造营') >= 0, true);
eq('渲染出今日进度 2/3', home.indexOf('2</b>/ 3') >= 0 || home.indexOf('/ 3 人') >= 0, true);
eq('已打卡区块存在', home.indexOf('已打卡') >= 0, true);
eq('未打卡区块存在', home.indexOf('未打卡') >= 0, true);
eq('未打卡里出现周八', home.indexOf('周八') >= 0, true);
eq('打卡按钮指向问卷', home.indexOf('wjx.cn/vm/test.aspx') >= 0, true);
eq('近7天图表存在', home.indexOf('近 7 天打卡人数') >= 0, true);
eq('张三心得被渲染', home.indexOf('读了 32 页') >= 0, true);

console.log('\n[8] 渲染异常输入不崩');
let crashed = null;
try {
  CC.renderHome({ org:'', title:'', surveyUrl:'', dataUrl:'', proxy:'', members:'', types:'', manual:'' },
                { ok:false, err:'读取超时', rows:[] });
} catch (e) { crashed = e.message; }
eq('空配置 + 失败数据不抛错', crashed, null);

console.log('\n[9] XSS 转义');
eq('尖括号被转义', CC.esc('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
const evil = CC.renderHome(cfg2, { ok:true, rows:[{ name:'<img src=x onerror=alert(1)>', type:'读书', date:T, note:'' }] });
eq('恶意名字不产出可执行标签', evil.indexOf('<img src=x') >= 0, false);

console.log('\n[10] 设置页渲染 renderSetup');
const setup = CC.renderSetup(cfg2);
eq('含问卷链接输入框', setup.indexOf('id="f_survey"') >= 0, true);
eq('含公开数据地址输入框', setup.indexOf('id="f_data"') >= 0, true);
eq('含成员名单输入框', setup.indexOf('id="f_members"') >= 0, true);
eq('含保存按钮', setup.indexOf('id="save"') >= 0, true);

console.log('\n----------------------------------------');
console.log(fail === 0 ? `全部通过 (${pass} 项)` : `${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
