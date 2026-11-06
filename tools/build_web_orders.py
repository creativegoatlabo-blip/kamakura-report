"""Add the verified WEB order summary without regenerating reservation metrics."""
import argparse
import calendar
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
START = '<!-- web-orders:start -->'
END = '<!-- web-orders:end -->'
TYPES = ['結婚指輪', '婚約指輪', 'アニバーサリー', 'プロポーズ']
STATUSES = ['見積中', '製作中', '納品済み', 'キャンセル']


def summarize(month):
    counts = month['counts']
    if any(r['type'] not in TYPES or r['status'] not in STATUSES
           or type(r['count']) is not int or r['count'] < 0 for r in counts):
        raise ValueError('Unsupported order type, status, or count')
    statuses = {s: sum(r['count'] for r in counts if r['status'] == s) for s in STATUSES}
    confirmed = statuses['製作中'] + statuses['納品済み']
    by_type = {t: sum(r['count'] for r in counts if r['type'] == t
                     and r['status'] in ['製作中', '納品済み']) for t in TYPES}
    assert confirmed == sum(by_type.values())
    return dict(total=sum(statuses.values()), confirmed=confirmed, by_type=by_type,
                statuses=statuses, excluded_tests=month['excluded_tests'])


def render(source, month):
    current = source['months'][month]
    s = summarize(current)
    y, m = map(int, month.split('-'))
    through = current['through']
    observed_on = current.get('observed_on', source['observed_on'])
    partial = int(through[-2:]) != calendar.monthrange(y, m)[1]
    period = f'{m}月1〜{int(through[-2:])}日受付分' + ('（月途中）' if partial else '')
    cards = [('有効受付（製作中・納品済み）', f'{s["confirmed"]}件'),
             ('見積中', f'{s["statuses"]["見積中"]}件'),
             ('キャンセル', f'{s["statuses"]["キャンセル"]}件'), ('WEBオーダー売上', '未取得')]
    card_html = ''.join(f'<div class="rounded-lg bg-gray-50 p-4"><p class="text-xs text-gray-600">{label}</p><p class="text-2xl font-bold text-gray-800 mt-2">{value}</p></div>' for label, value in cards)
    type_rows = ''.join(f'<tr><th scope="row">{t}</th><td>{s["by_type"][t]}件</td></tr>' for t in TYPES)
    monthly_rows = []
    for key, entry in sorted(source['months'].items()):
        if key > month:
            continue
        v = summarize(entry)
        label = key.replace('-', '/') + (f'（{int(entry["through"][-2:])}日まで）' if key == '2026-11' else '')
        values = [v['confirmed'], v['confirmed'] - v['by_type']['プロポーズ'], v['by_type']['プロポーズ'], v['statuses']['見積中'], v['statuses']['キャンセル']]
        selected = ' class="web-orders-current"' if key == month else ''
        monthly_rows.append(f'<tr{selected}><th scope="row">{label}</th>' + ''.join(f'<td>{n}</td>' for n in values) + '</tr>')
    payload = {'month': month, 'through': through, 'observed_on': observed_on, **s, 'sales_jpy': None}
    return f'''{START}
<section id="webOrdersSection" class="glass-card p-6 mb-8" aria-labelledby="webOrdersHeading">
  <h2 id="webOrdersHeading" class="text-xl font-bold text-gray-800 mb-3">WEBオーダーの成果</h2>
  <p class="text-sm text-gray-600 mb-4">{period} ／ 管理画面確認：{observed_on}。本店のWEBオーダー専用管理一覧を集計しています。</p>
  <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">{card_html}</div>
  <p class="text-sm text-gray-600 mb-4">有効受付の現在の状態：製作中 {s['statuses']['製作中']}件・納品済み {s['statuses']['納品済み']}件。テスト登録 {s['excluded_tests']}件を除外。</p>
  <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
    <div><h3 class="font-bold text-gray-800 mb-2">種類別の有効受付（{m}月）</h3><table class="web-orders-table"><thead><tr><th scope="col">種類</th><th scope="col">件数</th></tr></thead><tbody>{type_rows}</tbody></table></div>
    <div class="lg:col-span-2 min-w-0"><h3 class="font-bold text-gray-800 mb-2">月別推移（受付日基準）</h3><div class="overflow-x-auto"><table class="web-orders-table whitespace-nowrap"><thead><tr><th scope="col">受付月</th><th scope="col">有効受付</th><th scope="col">通常WEB</th><th scope="col">プロポーズ</th><th scope="col">見積中</th><th scope="col">取消</th></tr></thead><tbody>{''.join(monthly_rows)}</tbody></table></div></div>
  </div>
  <p class="text-xs text-gray-600 mt-4">有効受付は「製作中＋納品済み」。見積中・キャンセル・テスト登録を含みません。通常WEBは結婚指輪・婚約指輪・アニバーサリーの合計です。「別途見積」欄の印は見積中の件数とは別です。1登録を1件として数え、指輪本数・人数には換算していません。</p>
  <p class="text-xs text-gray-600 mt-2">納品済みはこの受付月の注文の現在の状態であり、当月に納品した件数ではありません。月途中の数値は翌日以降を含まず、前年値は未取得です。売上・見積依頼からの成約率は未取得。店舗予約の合計・ブライダルCPAには加算していません。</p>
</section>
<style>.web-orders-table{{width:100%;font-size:14px;border-collapse:collapse}}.web-orders-table th,.web-orders-table td{{padding:10px 8px;border-bottom:1px solid #e5e7eb;text-align:right}}.web-orders-table th:first-child{{text-align:left}}.web-orders-table thead{{background:#f9fafb}}.web-orders-table tbody th{{font-weight:400}}.web-orders-current{{background:#eef2ff}}</style>
<script type="application/json" id="webOrdersData">{json.dumps(payload, ensure_ascii=False)}</script>
{END}'''


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=ROOT)
    args = parser.parse_args()
    source = json.loads((args.root/'assets/web-orders-summary.json').read_text())
    changed = []
    for path in sorted(args.root.glob('all_course_report*.html')):
        text = path.read_text()
        match = re.search(r'<title>(\d{4})年(\d+)月', text)
        if not match:
            continue
        month = f'{match[1]}-{int(match[2]):02}'
        if month not in source['months']:
            continue
        text = re.sub(re.escape(START)+r'.*?'+re.escape(END)+r'\n?', '', text, flags=re.S)
        marker = '        <!-- Cost & ROAS KPI Cards -->'
        if text.count(marker) != 1:
            raise ValueError(f'Missing unique insertion point: {path.name}')
        text = text.replace(marker, render(source, month)+'\n'+marker, 1)
        path.write_text(text)
        changed.append(path.name)
    print(json.dumps({'updated': changed}, ensure_ascii=False))


if __name__ == '__main__':
    main()
