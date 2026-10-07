"""Prepare four end-to-end assignments for Fielora, not completed solutions.

All business records are synthetic. The documentation assignment uses a pinned
selection of real repository files. Expected answers stay outside project roots.
"""
import argparse
import csv
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
import hashlib
import io
import json
from pathlib import Path
import shutil
import subprocess


def write(root, relative, text):
    file = root / relative
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_bytes(text.encode('utf-8'))


def table(root, relative, columns, rows):
    out = io.StringIO(newline='')
    writer = csv.DictWriter(out, fieldnames=columns, lineterminator='\n')
    writer.writeheader()
    writer.writerows(rows)
    write(root, relative, out.getvalue())


def money(cents):
    return f'{Decimal(cents) / 100:.2f}'


STUDIO_TASK = """请在当前项目里做一个我可以日常使用的“工作室项目与回款管理器”。

我是一个小型设计工作室的负责人，客户、项目和回款现在散落在三张 CSV 中。
input 里的数据就是首次导入材料。请交付完整可运行的软件，不只给设计稿或代码片段。

我要在一个中文界面里做到：
1. 查看客户和项目，新增、编辑项目，记录分次回款；每条数据都有稳定 ID。
2. 按客户、阶段和项目名搜索筛选；可以查看项目详情和回款明细。
3. 首页显示合同总额、已回款、待回款、超额回款，以及按客户汇总。
4. 支持导入这三张 CSV；重复导入不能重复记账。有问题的记录单独列出来，不能悄悄丢弃。
5. 修改后刷新页面、退出并重新启动，数据都还在；可以导出完整 JSON 备份并恢复。
6. 浅色界面，信息清楚，表格和金额好读，窄窗口也能操作。不要只有几个静态卡片。

业务口径：币种统一为人民币；金额精确到分。取消项目不计入首页金额汇总，但可以查询。
同一回款 ID 只计一次；不存在项目的回款不计入金额，进入问题列表。
待回款按每个项目 max(合同额-累计回款, 0) 再求和；多收到的钱单列超额回款，不能抵消其他项目的欠款。
导入相同 ID 但内容冲突时保留原数据并报告冲突。备份导入是明确确认后的完整恢复，不能叠加复制。

请自行选择合适的技术实现，在本机启动并实际验证导入、编辑、筛选、备份恢复和重启。
不需要登录、支付接口或云服务。最终交付完整源码、启动入口、使用说明和真实检查结果。
保留 input 原始数据。如果有没完成的地方明确列出，不把模拟数据页面说成完整实现。
"""

STUDIO_FOLLOWUP = """继续修改这个工作室管理器：

增加“逾期回款”。我希望给项目设一个约定回款日期，在首页看到超过该日期且仍有待回款的项目。
新增字段不能破坏现有数据，旧项目没有日期就显示“未设置”，也不算逾期。
比较时用本地日期，截止当天不算逾期。增加“逾期 / 未逾期 / 未设置”筛选。
请保留我已经导入和修改的内容，完成后实际验证旧数据、筛选和重启。
"""

HELPDESK_TASK = """请接手这个已经能运行的“售后工单台”，把它修到可以给同事使用。

启动方式是 node server.mjs，浏览器地址以终端输出为准。现有代码、input 工单和界面都在项目中。
用户反馈：
1. 首页“待处理”数量不对，好像把处理中的工单也算进去了。
2. 搜索 API 有时找不到，关键词前后多一个空格也会影响结果。
3. 把工单改成已解决，当时页面看起来成功，刷新后却又变回去了。
4. 筛选后导出 CSV，导出的内容跟屏幕上不一致；含逗号、引号和换行的内容还会串列。

请查明并修好这些问题，同时增加“逾期未解决”筛选和负责人筛选，能与关键词组合使用。
业务口径：待处理只指 open；in_progress 单列；closed 为已解决。
逾期指 due_date 早于本地今天且 status 不是 closed；到期当天和未设置日期不算逾期。
关键词去首尾空白，忽略拉丁字母大小写，匹配标题与描述。首页状态数量按全量数据，列表数量按筛选后数据。
导出只包含当前筛选结果，字段保持 id、title、description、status、priority、assignee、due_date、created_at。

保留现有工单、用户修改、中文文案和可用功能；不要直接换成另一个新演示项目。
请补充能防止这些问题复发的测试，并实际打开页面验证。最终说明原因、修改、验证与未解决问题。
"""

HELPDESK_HTML = """<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>售后工单台</title><link rel="stylesheet" href="style.css"></head><body><main>
<header><div><span class="eyebrow">客户支持工作台</span><h1>售后工单台</h1><p>跟进客户问题，保留每一次处理结果。</p></div><button id="export">导出 CSV</button></header>
<section class="metrics"><article>待处理<strong id="open-count"></strong></article><article>处理中<strong id="progress-count"></strong></article><article>已解决<strong id="closed-count"></strong></article></section>
<section class="toolbar"><input id="query" aria-label="搜索工单" placeholder="搜索标题和描述"><select id="status" aria-label="状态"><option value="">全部状态</option><option value="open">待处理</option><option value="in_progress">处理中</option><option value="closed">已解决</option></select><span id="count"></span></section>
<section class="table-wrap"><table><thead><tr><th>工单</th><th>优先级</th><th>负责人</th><th>到期日</th><th>状态</th></tr></thead><tbody id="rows"></tbody></table></section><p id="feedback" role="status"></p>
</main><script type="module" src="app.mjs"></script></body></html>
"""

HELPDESK_CSS = """*{box-sizing:border-box}body{margin:0;background:#f4f5f8;color:#202430;font:15px system-ui}main{max-width:1160px;margin:42px auto;padding:0 28px}header,.toolbar{display:flex;align-items:center;justify-content:space-between;gap:16px}h1{font-size:30px;margin:8px 0}.eyebrow,header p{color:#687386}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:28px 0}.metrics article{background:white;border:1px solid #e1e5ec;border-radius:14px;padding:20px;color:#687386}.metrics strong{display:block;font-size:30px;color:#202430;margin-top:8px}button,input,select{font:inherit;border:1px solid #d4dae4;border-radius:8px;padding:10px 14px;background:white}button{cursor:pointer;color:#424b99}input{flex:1;min-width:120px}.toolbar{margin:22px 0}#count{color:#687386;white-space:nowrap}.table-wrap{overflow:auto;background:white;border:1px solid #e1e5ec;border-radius:12px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:14px;border-bottom:1px solid #edf0f5;vertical-align:top}th{font-weight:500;color:#687386}td:first-child{min-width:260px}small{display:block;color:#687386;white-space:pre-wrap;margin-top:5px}td select{max-width:140px}#feedback{color:#667065}@media(max-width:760px){main{padding:0 14px}.toolbar{flex-wrap:wrap}.metrics{gap:8px}.metrics article{padding:12px}}
"""

HELPDESK_MODEL = """export function statusCounts(tickets) {
  return {
    open: tickets.filter(t => t.status !== 'closed').length,
    in_progress: tickets.filter(t => t.status === 'in_progress').length,
    closed: tickets.filter(t => t.status === 'closed').length,
  };
}
export function selectTickets(tickets, { query = '', status = '' } = {}) {
  return tickets.filter(t => (!status || t.status === status) &&
    (!query || `${t.title} ${t.description}`.includes(query)));
}
export function toCsv(tickets) {
  const fields = ['id','title','description','status','priority','assignee','due_date','created_at'];
  return [fields.join(','), ...tickets.map(t => fields.map(f => t[f]).join(','))].join('\\n');
}
"""

HELPDESK_APP = """import { statusCounts, selectTickets, toCsv } from './model.mjs';
const KEY = 'fielora-helpdesk-assignment-v1';
const saved = localStorage.getItem(KEY);
let tickets = saved ? JSON.parse(saved) : await fetch('/input/tickets.json').then(r => r.json());
if (!saved) localStorage.setItem(KEY, JSON.stringify(tickets));
const query = document.getElementById('query'), status = document.getElementById('status');
function textCell(value) { const cell=document.createElement('td'); cell.textContent=value; return cell; }
function render() {
  const counts=statusCounts(tickets);
  document.getElementById('open-count').textContent=counts.open;
  document.getElementById('progress-count').textContent=counts.in_progress;
  document.getElementById('closed-count').textContent=counts.closed;
  const visible=selectTickets(tickets,{query:query.value,status:status.value});
  document.getElementById('count').textContent=`${visible.length} 条工单`;
  const rows=document.getElementById('rows'); rows.replaceChildren();
  for(const ticket of visible) {
    const row=document.createElement('tr'), main=textCell(`${ticket.id} · ${ticket.title}`), detail=document.createElement('small');
    detail.textContent=ticket.description;main.append(detail);row.append(main,textCell(ticket.priority),textCell(ticket.assignee),textCell(ticket.due_date||'未设置'));
    const cell=document.createElement('td'), select=document.createElement('select'); select.setAttribute('aria-label',`${ticket.id} 状态`);
    for(const [value,label] of [['open','待处理'],['in_progress','处理中'],['closed','已解决']]) { const option=document.createElement('option');option.value=value;option.textContent=label;select.append(option); }
    select.value=ticket.status;select.addEventListener('change',()=>{ticket.status=select.value;render();document.getElementById('feedback').textContent=`${ticket.id} 已更新`;});
    cell.append(select);row.append(cell);rows.append(row);
  }
}
query.addEventListener('input',render);status.addEventListener('change',render);
document.getElementById('export').addEventListener('click',()=>{
  const url=URL.createObjectURL(new Blob(['\\ufeff'+toCsv(tickets)],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download='工单.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
render();
"""

SERVER = """import http from 'node:http';
import { readFile } from 'node:fs/promises';
const entries = new Map([
 ['/', ['index.html','text/html; charset=utf-8']],
 ['/style.css',['style.css','text/css; charset=utf-8']],
 ['/app.mjs',['app.mjs','text/javascript; charset=utf-8']],
 ['/model.mjs',['model.mjs','text/javascript; charset=utf-8']],
 ['/input/tickets.json',['input/tickets.json','application/json; charset=utf-8']],
]);
const port=Number(process.argv[2]??4317);
if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid port');
const server=http.createServer(async(req,res)=>{
 const file=entries.get(new URL(req.url,'http://localhost').pathname);
 if(!file){res.writeHead(404).end('Not found');return;}
 try{const bytes=await readFile(new URL(file[0],import.meta.url));res.writeHead(200,{'content-type':file[1],'cache-control':'no-store'}).end(bytes);}
 catch{res.writeHead(500).end('Read failed');}
});
server.listen(port,'127.0.0.1',()=>console.log(`http://127.0.0.1:${port}`));
"""

REPORT_TASK = """请把 input 中的订单、退款和渠道费率三张表，做成可以交给经营负责人的月度经营报告。

这是一个小型数字产品店的 2026 年 9 月数据，所有金额为人民币。请自行读取数据、处理异常、计算结果并做成品。

交付 output/report.html（离线可打开的中文交互报告）、output/summary.json、output/channel-summary.csv、output/exceptions.csv，以及可重新运行的分析脚本和简短说明。
报告要有净收入、退款、渠道费、渠道对比、每日趋势、产品排行和异常记录，至少能按渠道筛选；选择渠道时所有图表与指标一起更新。不能依赖远程 CDN。

计算口径：
订单按 order_id 去重，保留第一条；只统计 PAID 且 quantity 为正整数、unit_price 为合法非负两位小数、渠道有费率的订单。
订单金额=单价×数量。退款按 refund_id 去重保留第一条；只接受成功退款（SUCCESS）、关联有效已支付订单、金额为合法正数，且同一订单累计成功退款不超过订单金额的记录；超额那条整条拒绝并列为异常。
渠道费每个有效订单单独计算并四舍五入到分，然后汇总；退款不退渠道费。
净收入=有效订单金额-有效退款金额-渠道费。日期分析统一按原订单日期，退款也归回原订单日期。
重复、无效、未支付、取消和退款不成功的记录都进入 exceptions.csv，给出源表、行号和原因。

summary.json 使用 paid_order_count、gross、refunds、fees、net、exception_count、by_channel 七个字段；金额为两位小数字符串。by_channel 是渠道名称到同样前五项统计的映射。
不要改 input 原文件，不虚构缺失数据，也不要只写一段分析结论。请核对数字和报告交互，并交付实际文件。
"""

DOC_TASK = """请接手这份真实 Fielora 源码摘录，做一个新开发者拿到后就能看懂的中文技术说明站。

input/source 是从 Fielora 当前开发仓库逐文件复制的真实材料；input/source-manifest.json 记录提交、文件路径和摘要。它是摘录，不是完整仓库。

交付一个可离线打开的 output/index.html，包含：
1. Fielora 当前解决什么问题，哪些能力已有实现，哪些还不能承诺。
2. 可缩放的架构图：Desktop、Model、Harness、Capability、存储和凭据的职责；Harness 九层可以展开查看，但不要画成九个必须依次经过的服务。
3. 一条具体执行链：用户提出修复要求后，到模型提案、工具执行、检查、展示结果分别发生什么；用源码位置支持关键结论。
4. Mac 与 Windows 的现状差异、模型配置的边界、停止和恢复、字体安装流程。
5. 新同事最容易踩的 8 个问题及如何依据现有证据判断。

另交付架构图 SVG 和 source-map.json；每项关键事实关联真实相对路径、行号与简短依据，页面可查看来源。
历史文档可能互相矛盾，以最新明确决定和对应源码为准；解释仍未解决的冲突，不能把架构设想写成已实现，也不能从摘录没找到就断言整个项目没有。
页面浅色、中文可读、有搜索或目录跳转，980px 和 1440px 都能使用。不要用一张大图片替代整个说明站。
可以使用项目中确实可用的工具或 Skill。请实际打开检查，交付成品，不修改 input 源文件。
"""


def prepare(root, repo):
    review = root / '验收答案_不要作为Fielora项目导入'
    review.mkdir()
    projects = [root / name for name in ['01-工作室项目管理器', '02-售后工单修复', '03-月度经营报告', '04-Fielora技术说明站']]
    for project in projects:
        project.mkdir()
    studio, helpdesk, report, docs = projects
    write(studio, '任务.txt', STUDIO_TASK)
    write(review, '01-交付后追加的需求.txt', STUDIO_FOLLOWUP)
    clients = [{'client_id':f'C{i:03}', 'name':name, 'contact':contact} for i,(name,contact) in enumerate([
        ('栖木书店','林岚'),('青禾咖啡','周明'),('远山设计','许宁'),('白鹭科技','陈乔'),('岛屿杂志','吴晴'),('山谷市集','江舟')],1)]
    table(studio,'input/clients.csv',['client_id','name','contact'],clients)
    contracts = [18000,24000,12000,36000,8000,15000,26000,9000,42000,6000,16000,20000]
    stages=['active','delivered','active','completed','cancelled','active','delivered','completed','active','cancelled','active','delivered']
    names=['品牌更新','秋季菜单','包装设计','网站改版','活动海报','季度视觉','产品手册','封面设计','线上展厅','店内导视','会员页面','年度画册']
    prj=[{'project_id':f'P{i+1:03}','client_id':f'C{i%6+1:03}','name':names[i],'stage':stages[i],'contract_amount':f'{value}.00'} for i,value in enumerate(contracts)]
    table(studio,'input/projects.csv',['project_id','client_id','name','stage','contract_amount'],prj)
    pairs=[(1,5000),(1,3000),(2,20000),(4,36000),(5,1000),(6,18000),(7,10000),(7,5000),(8,9000),(9,12000),(11,6000),(12,5000)]
    payments=[{'receipt_id':f'R{i+1:03}','project_id':f'P{pid:03}','amount':f'{value}.00','received_on':f'2026-09-{i+1:02}'} for i,(pid,value) in enumerate(pairs)]
    payments += [dict(payments[1]),{'receipt_id':'R999','project_id':'P404','amount':'7000.00','received_on':'2026-09-20'}]
    table(studio,'input/receipts.csv',['receipt_id','project_id','amount','received_on'],payments)
    totals={'contract':0,'received':0,'outstanding':0,'overpaid':0}; per_project={}
    for i,p in enumerate(prj,1):
        received=sum(amount*100 for pid,amount in pairs if pid==i)
        contract=contracts[i-1]*100
        values={'contract':contract,'received':received,'outstanding':max(contract-received,0),'overpaid':max(received-contract,0)}
        per_project[p['project_id']]={key:money(value) for key,value in values.items()}
        if p['stage']!='cancelled':
            for key,value in values.items():totals[key]+=value
    write(review,'01-原始数据预期.json',json.dumps({'dashboard':{k:money(v) for k,v in totals.items()},'projects':per_project,'duplicate_receipt':'R002','orphan_receipt':'R999','source_note':'Synthetic business records; expected values are not a finished app'},ensure_ascii=False,indent=2)+'\n')

    write(helpdesk,'任务.txt',HELPDESK_TASK)
    for filename,body in [('index.html',HELPDESK_HTML),('style.css',HELPDESK_CSS),('model.mjs',HELPDESK_MODEL),('app.mjs',HELPDESK_APP),('server.mjs',SERVER)]:write(helpdesk,filename,body)
    titles=['API 回调返回 500','支付,回调失败','登录页面空白','导出报表乱码','会员重复扣费','优惠券未到账','移动端无法上传','发票抬头错误','api token 失效','订单状态不同步','下载链接过期','商品图不显示','修改密码失败','通知邮件重复','结算金额异常','退款状态延迟','收货地址丢失','界面按钮重叠']
    tickets=[]
    for i,title in enumerate(titles):
        tickets.append({'id':f'T{i+1:03}','title':title,'description':'客户备注："请尽快处理"\n第二次反馈，仍然存在。' if i==1 else f'客户反馈：{title}。请核对实际结果。',
            'status':'open' if i<10 else 'in_progress' if i<15 else 'closed', 'priority':['urgent','high','normal'][i%3],
            'assignee':['林岚','周明','许宁'][i%3], 'due_date': '2099-12-31' if i%4==0 else '' if i%4==1 else '2026-09-20', 'created_at':f'2026-09-{i+1:02}'})
    write(helpdesk,'input/tickets.json',json.dumps(tickets,ensure_ascii=False,indent=2)+'\n')
    write(helpdesk,'package.json',json.dumps({'name':'fielora-helpdesk-assignment','private':True,'type':'module','scripts':{'start':'node server.mjs'},'engines':{'node':'>=20'}},indent=2)+'\n')
    write(review,'02-工单预期.json',json.dumps({'initial_counts':{'open':10,'in_progress':5,'closed':3},'query_API_trim_casefold':['T001','T009'],'known_overdue_open_or_progress':['T003','T004','T007','T008','T011','T012','T015'],'date_condition':'valid for local dates after 2026-09-20 and before 2099-12-31; additionally verify today and blank date cases','csv_roundtrip':'T002 description contains both a double quote and newline; title contains comma'},ensure_ascii=False,indent=2)+'\n')

    write(report,'任务.txt',REPORT_TASK)
    rates={'官网':Decimal('0.02'),'平台店':Decimal('0.035'),'社群':Decimal('0.015')}
    products=['课程包','图标套装','设计模板','电子手册']; prices=[19900,4900,12900,2900]
    orders=[]
    for i in range(1,181):
        index=(i-1)%4
        orders.append({'order_id':f'O{i:04}','order_date':str(date(2026,9,1)+timedelta(days=(i-1)%30)),
            'channel':list(rates)[(i-1)%3],'product':products[index],'quantity':str(1+(i%3)), 'unit_price':money(prices[index]),
            'status':'CANCELLED' if i%9==0 else 'PENDING' if i%11==0 else 'PAID'})
    orders += [dict(orders[i]) for i in [0,13,26,39,52]]
    orders += [{'order_id':'BAD001','order_date':'2026-09-12','channel':'官网','product':'课程包','quantity':'2','unit_price':'','status':'PAID'},
               {'order_id':'BAD002','order_date':'2026-09-13','channel':'未知渠道','product':'电子手册','quantity':'1','unit_price':'29.00','status':'PAID'}]
    table(report,'input/orders.csv',list(orders[0]),orders)
    eligible=[o for o in orders[:180] if o['status']=='PAID']
    refunds=[{'refund_id':f'F{i+1:03}','order_id':o['order_id'],'amount':money(int(Decimal(o['unit_price'])*100)//2),'status':'SUCCESS'} for i,o in enumerate(eligible[::11])]
    refunds += [dict(refunds[0]),dict(refunds[3]),{'refund_id':'F900','order_id':'O9999','amount':'10.00','status':'SUCCESS'},
                {'refund_id':'F901','order_id':'O0009','amount':'10.00','status':'SUCCESS'},
                {'refund_id':'F902','order_id':'O0001','amount':'9999.00','status':'SUCCESS'},
                {'refund_id':'F903','order_id':'O0002','amount':'10.00','status':'FAILED'}]
    table(report,'input/refunds.csv',list(refunds[0]),refunds)
    table(report,'input/channel-rates.csv',['channel','rate'],[{'channel':k,'rate':str(v)} for k,v in rates.items()])
    # Calculate a separate oracle from the records, in integer cents.
    stats={channel:{'paid_order_count':0,'gross':0,'refunds':0,'fees':0,'net':0} for channel in rates}
    accepted={}; seen=set(); exceptions=[]
    for line,o in enumerate(orders,2):
        reason=None
        if o['order_id'] in seen:reason='重复订单'
        elif o['status']!='PAID':reason='非已支付订单'
        elif not o['unit_price']:reason='缺少合法单价'
        elif o['channel'] not in rates:reason='未知渠道'
        seen.add(o['order_id'])
        if reason:exceptions.append({'table':'orders.csv','line':line,'id':o['order_id'],'reason':reason});continue
        gross=int(Decimal(o['unit_price'])*100)*int(o['quantity'])
        fee=int((Decimal(gross)*rates[o['channel']]).quantize(Decimal('1'),rounding=ROUND_HALF_UP))
        accepted[o['order_id']]={'order':o,'gross':gross,'refunded':0}
        s=stats[o['channel']];s['paid_order_count']+=1;s['gross']+=gross;s['fees']+=fee
    seen=set()
    for line,r in enumerate(refunds,2):
        reason=None; order=accepted.get(r['order_id']); amount=int(Decimal(r['amount'])*100)
        if r['refund_id'] in seen:reason='重复退款'
        elif r['status']!='SUCCESS':reason='退款未成功'
        elif not order:reason='没有有效已支付订单'
        elif order['refunded']+amount>order['gross']:reason='累计退款超额'
        seen.add(r['refund_id'])
        if reason:exceptions.append({'table':'refunds.csv','line':line,'id':r['refund_id'],'reason':reason});continue
        order['refunded']+=amount;stats[order['order']['channel']]['refunds']+=amount
    for s in stats.values():s['net']=s['gross']-s['refunds']-s['fees']
    summary={key:sum(s[key] for s in stats.values()) for key in ['paid_order_count','gross','refunds','fees','net']}
    summary={key:value if key=='paid_order_count' else money(value) for key,value in summary.items()}
    summary['exception_count']=len(exceptions)
    summary['by_channel']={channel:{key:value if key=='paid_order_count' else money(value) for key,value in s.items()} for channel,s in stats.items()}
    write(review,'03-经营报告预期.json',json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
    write(review,'03-异常记录预期.json',json.dumps(exceptions,ensure_ascii=False,indent=2)+'\n')

    write(docs,'任务.txt',DOC_TASK)
    selected=['README.md','LICENSE','NOTICE','package.json','apps/desktop/src/main.ts','apps/desktop/src/preload.ts',
        'apps/desktop/src/renderer/AppearanceSettings.tsx','apps/desktop/src/renderer/ModelServicesSettings.tsx',
        'apps/desktop/src/renderer/app-preferences.ts','apps/desktop/src/renderer/styles/materials.css',
        'crates/fielora-core/src/agent_runtime.rs','crates/fielora-agent/src/capability_catalog.rs','crates/fielora-agent/src/fonts.rs',
        'crates/fielora-platform/src/fonts.rs','crates/fielora-model/src/profile.rs',
        'docs/product/RAPID_DESKTOP_EXECUTION_V0.1.md','docs/context/02_PROJECT_REALITY.md','docs/context/03_DECISIONS.md',
        'docs/architecture/AGENT_ENGINEERING_VIEWS_V0.1.md','docs/architecture/FIELORA_V0.1_AGENT_ARCHITECTURE_SPEC.md',
        'docs/engineering/MACOS_DEVELOPMENT.md','docs/engineering/AGENT_DESIGN_IMPLEMENTATION_LESSONS.md',
        'docs/engineering/FONT_INSTALLATION_CHANGE_IMPACT.md','docs/engineering/MODEL_RUNTIME_VALIDATION.md']
    manifest={}
    for relative in selected:
        source=repo/relative; target=docs/'input/source'/relative;target.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(source,target);manifest[relative]=hashlib.sha256(target.read_bytes()).hexdigest()
    commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip()
    write(docs,'input/source-manifest.json',json.dumps({'commit':commit,'kind':'selected_current_worktree_files','files':manifest},ensure_ascii=False,indent=2)+'\n')
    write(review,'04-必须核对的事实.txt','Model + Harness + Capability；Harness 九层是职责划分，不是九个服务。\nIDR 已退出生产；完整 DXE/Personal Steward 尚非现有产品承诺。\n浅色模式；macOS 原生窗口控件默认常显；原生磨砂与网页 backdrop-filter 叠加曾导致残影。\nMac 已有原生开发与字体验证，不代表 Windows/全部跨平台能力都验证。\n字体安装到当前用户目录，沿原有审批和回执；不能用其回执证明项目代码正确。\n项目内 fixture/工程 PASS 不能证明真实模型完成 Archify 原任务。\n每个来源行号必须能在本项目 source 摘录里核对。\n')

    for project in projects:
        for args in [['git','init','--quiet'],['git','add','.'],['git','-c','user.name=Fielora Assignment','-c','user.email=assignment@example.invalid','-c','commit.gpgsign=false','commit','--quiet','-m','Original assignment inputs']]:
            subprocess.run(args,cwd=project,check=True,capture_output=True)
    inputs={}
    for project in projects:
        for p in sorted(project.rglob('*')):
            if p.is_file() and '.git' not in p.parts:
                inputs[str(p.relative_to(root))]=hashlib.sha256(p.read_bytes()).hexdigest()
    write(review,'原始材料摘要.json',json.dumps(inputs,ensure_ascii=False,indent=2)+'\n')
    write(root,'项目清单.txt','这些是交给 Fielora 完成的真实工作任务，不是已完成的软件。业务数据为合成样本；第 4 项使用真实源码。\n\n'
          +'\n'.join(str(p)+'\n委托内容：'+str(p/'任务.txt')+'\n' for p in projects)
          +'\n四个项目分开导入。验收答案目录供结果核对，不作为被测项目或输入提示。\n当前状态：材料已准备，Fielora 尚未执行。\n')
    return {'directory':str(root),'projects':len(projects),'studio_expected':{k:money(v) for k,v in totals.items()},'report_expected':summary,'source_files':len(selected),'fielora_execution':'NOT_STARTED'}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination',type=Path)
    args=parser.parse_args();repo=Path(__file__).resolve().parents[2];root=args.destination.expanduser().resolve()
    if root.exists() or root==repo or repo in root.parents:parser.error('Choose a new directory outside the repository; existing files are never replaced')
    root.mkdir(parents=True)
    print(json.dumps(prepare(root,repo),ensure_ascii=False,indent=2))
