"""Render recent tour conversion rates and full-history booking durations."""

import argparse
import html
import json
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from statistics import median


START = "<!-- visit-bridal-conversion:start -->"
END = "<!-- visit-bridal-conversion:end -->"
REPEATER_MARKER = "        <!-- Repeater Analysis Section -->"
COURSES = (
    "結婚指輪手作りコース",
    "結婚・婚約指輪手作りコース（３本制作）",
    "婚約指輪手作りコース",
    "ダイヤモンドプロポーズコース",
)
STORES = {
    "kamakura_course_report": "鎌倉本店",
    "yokohama_course_report": "横浜元町",
    "course_report": "大阪中崎町",
    "kuramae_course_report": "東京蔵前",
    "all_course_report": "全店",
}


def normalize_kana(value):
    text = re.sub(r"\s+", "", unicodedata.normalize("NFKC", str(value or "")))
    return "".join(chr(ord(c) - 96) if "ァ" <= c <= "ヶ" else c for c in text)


def normalize_name(value):
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", str(value or "")))


def normalize_phone(value):
    phone = re.sub(r"\D", "", normalize_name(value))
    if phone.startswith("81") and len(phone) in (11, 12):
        phone = "0" + phone[2:]
    return phone if len(phone) >= 9 and not re.fullmatch(r"(\d)\1+", phone) else ""


def normalize_email(value):
    email = normalize_name(value).lower()
    return email if re.fullmatch(r"[^@]+@[^@]+\.[^@]+", email) else ""


def match_reasons(first, second):
    def parties(row):
        return [{**row, "partner": False}] + [
            {**person, "partner": True} for person in row.get("partners", [])
        ]

    reasons = set()
    for a in parties(first):
        for b in parties(second):
            companion = a["partner"] or b["partner"]
            for field, normalizer, reason in (
                ("kana", normalize_kana, "companion_kana" if companion else "primary_kana"),
                ("phone", normalize_phone, "companion_phone" if companion else "phone"),
                ("email", normalize_email, "email"),
            ):
                value = normalizer(a.get(field))
                if value and value == normalizer(b.get(field)):
                    reasons.add(reason)
            name = normalize_name(a.get("name"))
            if companion and len(name) >= 3 and name == normalize_name(b.get("name")):
                reasons.add("companion_name")
    return reasons


def parse_date(value):
    match = re.match(r"^(\d{4})[-/](\d{2})[-/](\d{2})", str(value or ""))
    return date(*map(int, match.groups())) if match else None


def cohort_start(as_of):
    """The first day of the report month and its preceding two months."""
    month_index = as_of.year * 12 + as_of.month - 3
    return date(month_index // 12, month_index % 12 + 1, 1)


def timing_order(case):
    return (-case["days"], case["tour_date"], case["bridal_accepted_date"],
            case["origin_store"], case["destination_store"], case["course"])


def timing_metrics(day_counts, top5):
    days = sorted(day for day, count in day_counts.items() for _ in range(count))
    return {
        "count": len(days), "total_days": sum(days),
        "mean_days": round(sum(days) / len(days), 1) if days else None,
        "median_days": median(days) if days else None,
        "max_days": max(days) if days else None,
        "same_day_count": day_counts.get(0, 0),
        "day_counts": [{"days": d, "count": c} for d, c in sorted(day_counts.items())],
        "top5": sorted(top5, key=timing_order)[:5],
    }


def summarize_timing(cases, end_field="bridal_accepted_date"):
    """Keep only anonymous scheduling fields, durations, and aggregate counts."""
    ranked = []
    for case in cases:
        days = (parse_date(case[end_field]) - parse_date(case["tour_date"])).days
        if days < 0:
            raise ValueError("Booking must follow the tour date")
        ranked.append({**{key: case[key] for key in (
            "origin_store", "destination_store", "tour_date", "bridal_accepted_date",
            "bridal_production_date", "course"
        )}, "days": days, **({"match_basis": case["match_basis"]} if "match_basis" in case else {})})
    return timing_metrics(Counter(c["days"] for c in ranked), ranked)


def aggregate_timing(summaries):
    counts = Counter()
    for summary in summaries:
        counts.update({c["days"]: c["count"] for c in summary["day_counts"]})
    return timing_metrics(counts, [c for s in summaries for c in s["top5"]])


def identity_tokens(row):
    tokens = set()
    for companion, person in [(False, row)] + [(True, p) for p in row.get("partners", [])]:
        for field, normalizer in (("kana", normalize_kana), ("phone", normalize_phone), ("email", normalize_email)):
            value = normalizer(person.get(field))
            if value:
                tokens.add((field, value))
        name = normalize_name(person.get("name"))
        if len(name) >= 3:
            tokens.add(("partner_name" if companion else "primary_name", name))
    return tokens


def matching_indices(tokens, index):
    matched = set()
    for kind, value in tokens:
        kinds = ("partner_name",) if kind == "primary_name" else (
            ("primary_name", "partner_name") if kind == "partner_name" else (kind,)
        )
        for lookup in kinds:
            matched.update(index.get((lookup, value), ()))
    return matched


def matched_groups(rows, cutoff, start='2026-07-01'):
    """Existing exact identity rules, with all eligibility bounded by the cutoff."""
    end, begin = parse_date(cutoff), parse_date(start)
    visits, bookings, seen = [], [], set()
    for row in rows:
        key = (row.get('source_store', row['store']), row['no'])
        if key in seen:
            raise ValueError('Duplicate source reservation')
        seen.add(key)
        accepted, booked = parse_date(row.get('accepted')), parse_date(row.get('booked'))
        if row.get('cancel') or row.get('test') or not accepted or not booked or accepted > end:
            continue
        if '見学' in row['course'] and begin <= booked <= end:
            if not match_reasons(row, row):
                raise ValueError('Tour identity is unavailable')
            visits.append((row, booked, accepted))
        elif row['course'] in COURSES and begin <= accepted <= end:
            bookings.append((row, booked, accepted))
    parents = list(range(len(visits)))
    def root(i):
        while parents[i] != i:
            parents[i] = parents[parents[i]]
            i = parents[i]
        return i
    def join(indices):
        ids = sorted(indices)
        for i in ids[1:]:
            parents[root(i)] = root(ids[0])
    index = defaultdict(set)
    for i, (row, _, _) in enumerate(visits):
        tokens = identity_tokens(row)
        join(matching_indices(tokens, index) | {i})
        for token in tokens:
            index[token].add(i)
    candidates = defaultdict(set)
    for j, (row, _, _) in enumerate(bookings):
        matches = matching_indices(identity_tokens(row), index)
        join(matches)
        for i in matches:
            candidates[i].add(j)
    grouped = defaultdict(list)
    for i in range(len(visits)):
        grouped[root(i)].append(i)
    result = []
    for ids in grouped.values():
        first_i = min(ids, key=lambda i: (visits[i][1], visits[i][0].get('booked',''), visits[i][2], visits[i][0]['store'], visits[i][0]['no']))
        first, visited, _ = visits[first_i]
        eligible = [j for j in set().union(*(candidates[i] for i in ids))
                    if bookings[j][2] >= visited and bookings[j][1] >= visited]
        booking = min((bookings[j] for j in eligible), key=lambda b: (b[2], b[0]['no'], b[0]['store'], b[0]['course']), default=None)
        result.append({'origin_store': first['store'], 'tour_date': visited.isoformat(),
                       'first_accepted': booking[2].isoformat() if booking else None,
                       'destination_store': booking[0]['store'] if booking else None,
                       'lag_days': (booking[2]-visited).days if booking else None,
                       'elapsed_days': (end-visited).days})
    return result


def summarize_groups(groups, cutoff, start, store=None):
    selected = [g for g in groups if store is None or g['origin_store'] == store]
    begin, end = parse_date(start), parse_date(cutoff)
    months = []
    for idx in range(begin.year*12+begin.month-1, end.year*12+end.month):
        month = f'{idx//12:04}-{idx%12+1:02}'
        cohort = [g for g in selected if g['tour_date'].startswith(month)]
        row = {'month': month, 'total_groups': len(cohort)}
        for days in (30, 90):
            mature = [g for g in cohort if g['elapsed_days'] >= days]
            converted = sum(g['lag_days'] is not None and 0 <= g['lag_days'] <= days for g in mature)
            pending = len(cohort)-len(mature)
            row[f'days_{days}'] = {'eligible': len(mature), 'converted': converted, 'pending': pending,
                'rate': round(converted/len(mature)*100,1) if mature else None,
                'status': 'no_cohort' if not cohort else 'tracking' if pending else 'complete'}
        months.append(row)
    return {'months': months}


def calculate_followup(rows, cutoff, start='2026-07-01'):
    groups = matched_groups(rows, cutoff, start)
    names = list(STORES.values())[:4]
    result = {'schema_version':1, 'cutoff':cutoff, 'cohort_start':start,
              'basis':'scheduled_visit_date_to_bridal_accepted_date',
              'stores':{name:summarize_groups(groups,cutoff,start,name) for name in names},
              'all':summarize_groups(groups,cutoff,start)}
    validate_followup(result)
    return result


def validate_followup(result):
    for stats in [result['all'], *result['stores'].values()]:
        for row in stats['months']:
            for days in (30,90):
                v=row[f'days_{days}'];den=v['eligible'];num=v['converted'];pending=v['pending']
                assert den+pending==row['total_groups']
                assert 0 <= num <= den
                assert v['rate']==(round(num/den*100,1) if den else None)
                assert v['status']==('no_cohort' if not row['total_groups'] else 'tracking' if pending else 'complete')
    for i,row in enumerate(result['all']['months']):
        assert row['total_groups']==sum(s['months'][i]['total_groups'] for s in result['stores'].values())
        for days in (30,90):
            for key in ('eligible','converted','pending'):
                assert row[f'days_{days}'][key]==sum(s['months'][i][f'days_{days}'][key] for s in result['stores'].values())


def render_followup(result, store='全店'):
    stats=result['all'] if store=='全店' else result['stores'][store]
    rows=[]
    for row in stats['months']:
        total_label='—' if row.get('display_total',row['total_groups']) is None else str(row['total_groups'])
        cells=[f'<th scope="row">{row["month"].replace("-","/")}</th>',f'<td>{total_label}組</td>']
        for days in (30,90):
            v=row[f'days_{days}'];label={'no_cohort':'対象なし','tracking':'追跡中・暫定','complete':'追跡完了・確定'}[v['status']]
            quality=v.get('quality')
            if quality=='unverified':label=('追跡中・暫定／' if v['pending'] else '')+'取消時点未確認'
            elif quality=='reference':label={'complete':'追跡完了・参考値','tracking':'追跡中・暫定（参考）','no_cohort':'対象なし'}[v['status']]
            uncertain=set(v.get('uncertain_fields',['rate','converted','eligible','pending'] if quality=='unverified' else []))
            rate='—' if v['rate'] is None or 'rate' in uncertain else f'{v["rate"]:.1f}%'
            num='—' if 'converted' in uncertain else str(v['converted'])
            den='—' if 'eligible' in uncertain else str(v['eligible'])
            pending='—' if 'pending' in uncertain else str(v['pending'])
            cells += [f'<td class="followup-rate">{rate}</td>',f'<td>{num} / {den}組</td>',f'<td>{pending}組</td>',f'<td><span class="followup-status {v["status"]}">{label}</span></td>']
        rows.append('<tr>'+''.join(cells)+'</tr>')
    payload={'cutoff':result['cutoff'],'cohort_start':result['cohort_start'],'store':store,**stats}
    note=result.get('status_note','キャンセルは確認時点の状態。')
    return '''<!-- visit-followup:start -->
<section id="visitFollowupSection" class="glass-card p-6 mb-8" aria-labelledby="visitFollowupTitle">
<h2 id="visitFollowupTitle" class="text-2xl font-bold text-gray-800 mb-3">見学月別の30日・90日ブライダル予約率</h2>
<p class="text-sm text-gray-600 mb-4">集計締切：CUTOFF ／ 見学予定日ベース・実来店確認ではありません。検討期間をそろえるため、30日・90日が経過した組だけをそれぞれの分母・分子に含めます。</p>
<div class="overflow-x-auto"><table class="followup-table"><thead><tr><th rowspan="2" scope="col">見学月</th><th rowspan="2" scope="col">見学組数</th><th colspan="4" scope="colgroup">30日以内（0〜30日）</th><th colspan="4" scope="colgroup">90日以内（0〜90日）</th></tr><tr>HEADERS</tr></thead><tbody>ROWS</tbody></table></div>
<p class="text-xs text-gray-600 mt-4">「転換 / 対象」は、所定の日数を経過した対象組数と、そのうち期間内にブライダル予約を受け付けた組数です。未経過の組は予約済みでも両方から除外します。対象0組の率は「—」。未完了が残る月は「追跡中・暫定」、月全体の追跡が完了した場合のみ確定として扱います。</p>
<p class="text-xs text-gray-600 mt-2">対象は結婚指輪・3本制作・婚約指輪・ダイヤモンドプロポーズの4コース。転換日は制作予定日ではなく予約受付日、見学当日は0日です。見学前の受付は除外します。START以降の照合対象期間内で同一組の最初の見学月・見学店舗へ帰属し、店舗横断の予約と代表者・同伴者の完全一致照合を含みます。重複組は1組として数えます。照合対象期間が異なるため、直近3か月の速報とは月別母数が異なる場合があります。</p>
<p class="text-xs text-gray-600 mt-2">STATUSNOTE</p>
</section><style>.followup-table{width:100%;min-width:1000px;border-collapse:collapse;font-size:14px;font-variant-numeric:tabular-nums}.followup-table th,.followup-table td{padding:12px 10px;border-bottom:1px solid #e5e7eb;text-align:right;white-space:nowrap}.followup-table th:first-child{text-align:left}.followup-table thead{background:#f0fdfa}.followup-table thead th[colspan]{text-align:center}.followup-table tbody th{font-weight:500}.followup-rate{font-size:18px;font-weight:700;color:#0f766e}.followup-status{font-size:12px;padding:4px 8px;border-radius:5px;background:#f3f4f6}.followup-status.tracking{background:#fffbeb;color:#92400e}.followup-status.complete{background:#ecfdf5;color:#065f46}</style>
<script type="application/json" id="visitFollowupData">PAYLOAD</script>
<!-- visit-followup:end -->'''.replace('CUTOFF',html.escape(result['cutoff'])).replace('HEADERS',''.join('<th scope="col">'+x+'</th>' for x in ['率','転換 / 対象','追跡未完了','判定']*2)).replace('ROWS',''.join(rows)).replace('START',html.escape(result['cohort_start'])).replace('STATUSNOTE',html.escape(note)).replace('PAYLOAD',json.dumps(payload,ensure_ascii=False))
