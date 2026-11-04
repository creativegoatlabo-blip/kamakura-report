/* Daily counts are aggregated from the same reservation snapshot as the monthly report. */
(function (root) {
    'use strict';
    const mediaModes = ['ad_spend', 'ad_cpa'];
    const reservationModes = ['new_reservations', 'reservations', 'bridal_fashion', 'new_bridal_fashion'];
    const shortDate = value => value.slice(5).replace('-', '/');

    function buckets(daily, period) {
        const groups = [];
        daily.dates.forEach((day, index) => {
            const weekday = new Date(day + 'T00:00:00Z').getUTCDay();
            if (period === 'daily' || index === 0 || weekday === 1) groups.push([]);
            groups[groups.length - 1].push(index);
        });
        return groups;
    }

    function buildIntervalConfig(daily, period, mode, comparison = 'yoy') {
        const isMom = comparison === 'mom';
        const comparisonPrefix = isMom ? 'previous_month' : 'previous';
        const comparisonLabel = isMom ? '前月' : '前年';
        const accepted = mode.startsWith('new_');
        const groups = buckets(daily, period).filter(indices => !accepted || daily.dates[indices[0]] <= daily.accepted_through);
        const ranges = groups.map(indices => {
            const observed = indices.filter(i => !accepted || daily.dates[i] <= daily.accepted_through);
            const start = daily.dates[indices[0]];
            const end = daily.dates[indices[indices.length - 1]];
            const observedEnd = observed.length ? daily.dates[observed[observed.length - 1]] : null;
            const partial = observed.length > 0 && observed.length < indices.length;
            let label = shortDate(start) + (start === end ? '' : '〜' + shortDate(end));
            if (accepted && !observed.length) label += '（未集計）';
            else if (partial) label += '（途中）';
            return {indices, label, start, end, observedEnd, partial};
        });
        const total = (key, indices) => {
            const values = indices.map(i => daily[key][i]);
            return values.every(v => v === null) ? null : values.reduce((sum, v) => sum + (v ?? 0), 0);
        };
        const split = mode.endsWith('bridal_fashion');
        const metrics = split ? [
            {key: accepted ? 'new_bridal' : 'bridal', label: 'ブライダル', color: '#8b5cf6'},
            {key: accepted ? 'new_fashion' : 'fashion', label: 'ファッション', color: '#14b8a6'}
        ] : [{key: mode, label: accepted ? '新規予約数' : '予約数', color: '#3b82f6'}];
        const datasets = metrics.flatMap(metric => ['current', comparisonPrefix].map(prefix => ({
            label: (prefix === 'current' ? '当月 ' : comparisonLabel + '同期間 ') + metric.label,
            data: ranges.map(range => total(prefix + '_' + metric.key, range.indices)),
            borderColor: prefix !== 'current' && !split ? '#94a3b8' : metric.color,
            backgroundColor: metric.color,
            borderDash: prefix !== 'current' ? [5, 5] : [],
            borderWidth: 2, pointRadius: period === 'daily' ? 2 : 4,
            tension: 0, spanGaps: false
        })));
        return {
            type: 'line',
            data: {labels: ranges.map(range => range.label), datasets},
            options: {
                responsive: true, maintainAspectRatio: false, animation: false,
                interaction: {mode: 'index', intersect: false},
                scales: {
                    x: {ticks: {autoSkip: true, maxTicksLimit: period === 'daily' ? 12 : 6}},
                    y: {beginAtZero: true, ticks: {precision: 0}, title: {display: true, text: accepted ? '新規予約数（受付日ベース）' : '予約数（予約日ベース）'}}
                },
                plugins: {tooltip: {callbacks: {
                    title(items) {
                        if (!items.length) return '';
                        const range = ranges[items[0].dataIndex];
                        return range.start + (range.start === range.end ? '' : '〜' + range.end);
                    },
                    afterTitle(items) {
                        if (!items.length) return '';
                        const range = ranges[items[0].dataIndex];
                        const indices = range.indices.filter(i => !accepted || daily.dates[i] <= daily.accepted_through);
                        const comparedDates = indices.map(i => isMom ? daily.previous_month_dates[i] : daily.dates[i].replace(daily.month.slice(0, 4), String(daily.previous_year))).filter(Boolean);
                        return comparisonLabel + '：' + (comparedDates.length ? comparedDates[0] + '〜' + comparedDates[comparedDates.length - 1] : '対応する日付なし')
                            + (range.partial ? '（' + shortDate(range.observedEnd) + 'まで集計）' : '');
                    },
                    label(context) { return context.dataset.label + ': ' + context.parsed.y.toLocaleString() + '件'; }
                }}}
            }
        };
    }

    function buildMediaConfig(data, period, mode, comparison = 'yoy') {
        const monthly = period === 'monthly';
        const media = monthly ? data.advertising_trend : data.daily_media;
        const key = mode === 'ad_cpa' ? 'cpa' : 'spend';
        const label = key === 'cpa' ? '広告費ベースCPA' : '広告消化額';
        const prefix = comparison === 'mom' ? 'previous_month' : 'previous';
        const groups = monthly ? null : buckets(data.daily_trend, period).filter(g => data.daily_trend.dates[g[0]] <= data.daily_trend.accepted_through);
        const aggregate = (p, indices) => {
            const valid = indices.filter(i => data.daily_trend.dates[i] <= data.daily_trend.accepted_through);
            const spend = valid.map(i => media[p + '_spend']?.[i]);
            if (!spend.length || spend.some(v => v == null)) return null;
            const amount = spend.reduce((a,b) => a+b,0);
            if (key === 'spend') return amount;
            const counts = valid.map(i => media[p + '_bridal']?.[i]);
            if (counts.some(v => v == null)) return null;
            const total = counts.reduce((a,b) => a+b,0);
            return total ? amount / total : null;
        };
        const prefixes = monthly ? ['current','previous'] : ['current',prefix];
        const datasets = prefixes.map((p,i) => ({
            label: (i ? monthly ? '前期 ' : comparison === 'mom' ? '前月同期間 ' : '前年同期間 ' : monthly ? '今期 ' : '当月 ') + label,
            data: monthly ? media[p+'_'+key] : groups.map(g => aggregate(p,g)),
            borderColor: i ? '#94a3b8' : '#f97316', borderWidth:2, borderDash:i?[5,5]:[], pointRadius:3, tension:0, spanGaps:false
        }));
        return {type:'line',data:{labels:monthly ? data.monthly_trend.labels : groups.map(g => {
            const last = g.filter(i => data.daily_trend.dates[i] <= data.daily_trend.accepted_through).at(-1);
            const a=shortDate(data.daily_trend.dates[g[0]]),b=shortDate(data.daily_trend.dates[last]);
            return a+(a===b?'':'〜'+b);
        }),datasets},options:{responsive:true,maintainAspectRatio:false,animation:false,interaction:{mode:'index',intersect:false},scales:{y:{beginAtZero:true,title:{display:true,text:label+'（円）'},ticks:{callback:v=>'¥'+Math.round(v).toLocaleString()}}},plugins:{tooltip:{callbacks:{label:ctx=>ctx.dataset.label+': '+(ctx.parsed.y==null?'—':'¥'+Math.round(ctx.parsed.y).toLocaleString())}}}}};
    }

    function buildCostConfig(trend) {
        const datasets = ['current', 'previous'].map(prefix => ({
            label: (prefix === 'current' ? '今期 ' : '前期 ') + trend.label,
            data: trend[prefix + '_cost'],
            borderColor: prefix === 'current' ? '#f97316' : '#94a3b8',
            backgroundColor: 'transparent', borderWidth: 2,
            borderDash: prefix === 'previous' ? [5, 5] : [],
            tension: 0, spanGaps: false, pointRadius: 4
        }));
        return {type: 'line', data: {labels: trend.labels, datasets}, options: {
            responsive: true, maintainAspectRatio: false, animation: false,
            interaction: {mode: 'index', intersect: false},
            scales: {y: {beginAtZero: true, title: {display: true, text: '月間費用（円）'},
                ticks: {callback: value => '¥' + value.toLocaleString()}}},
            plugins: {tooltip: {callbacks: {
                label: context => context.dataset.label + ': ¥' + context.parsed.y.toLocaleString(),
                afterLabel(context) {
                    const meta = trend[(context.datasetIndex === 0 ? 'current' : 'previous') + '_meta'][context.dataIndex];
                    if (!meta) return '';
                    return meta.month + (meta.partial ? '（月途中：広告費は' + meta.through + 'まで）' : '（全月）')
                        + (meta.provisional ? '・暫定額' : '');
                }
            }}}
        }};
    }

    function init({data, selectorId, noteId, canvasId, initialMode, buildMonthly}) {
        const selector = document.getElementById(selectorId);
        const periodSelector = document.getElementById(selectorId + 'Period');
        const title = document.getElementById(selectorId + 'Title');
        const note = document.getElementById(noteId);
        const canvas = document.getElementById(canvasId);
        const comparisonSelector = document.getElementById('compareMode');
        const options = Array.from(selector.options).map(option => ({option, disabled: option.disabled, text: option.textContent}));
        const selected = options.find(item => item.option.value === initialMode && !item.disabled);
        if (selected) selector.value = initialMode;
        const modes = {monthly: selector.value, daily: mediaModes.includes(initialMode) ? initialMode : 'new_reservations', weekly: mediaModes.includes(initialMode) ? initialMode : 'new_reservations'};
        let lastPeriod = 'monthly';
        let chart;
        note.setAttribute('aria-live', 'polite');
        canvas.setAttribute('role', 'img');
        function render() {
            const period = periodSelector.value;
            const isMonthly = period === 'monthly';
            const unit = {monthly: '月次', daily: '日次', weekly: '週次'}[period];
            title.textContent = unit + '推移';
            options.forEach(({option, disabled, text}) => {
                const isMedia = mediaModes.includes(option.value);
                const monthlyOnly = !reservationModes.includes(option.value) && !isMedia;
                option.disabled = isMedia ? !(isMonthly ? data.advertising_trend : data.daily_media) : isMonthly ? disabled : monthlyOnly;
                option.textContent = text + (!isMonthly && monthlyOnly ? '（月次のみ）' : '');
            });
            if (selector.selectedOptions[0].disabled) selector.value = 'new_reservations';
            const mode = selector.value;
            let config;
            if (mediaModes.includes(mode)) {
                config = buildMediaConfig(data, period, mode, comparisonSelector?.value === 'mom' ? 'mom' : 'yoy');
                note.textContent = (data.daily_media?.scope_label || data.advertising_trend?.scope_label || '') + ' ／ Google＋Meta。固定掲載費を除く。CPAは同期間の広告費合計 ÷ 受付日基準・キャンセル除外のブライダル予約数。全流入を含み広告帰属を示しません。週次CPAは日次CPAの平均ではなく期間合計から計算。未取得の比較値は空欄。' + (isMonthly ? ' ' + (data.meta?.monthly_history_note || '') : ' 集計は' + data.daily_trend.accepted_through + 'まで。');
            } else if (isMonthly) {
                if (mode === 'monthly_cost') {
                    config = buildCostConfig(data.monthly_cost_trend);
                    note.textContent = data.monthly_cost_trend.label + ' ／ ' + data.monthly_cost_trend.note;
                    data.monthly_cost_trend.current_meta.filter(meta => meta?.partial).forEach(meta => {
                        note.textContent += meta.month + '：広告費は' + meta.through + 'まで' + (meta.provisional ? '・暫定額' : '') + '。';
                    });
                } else {
                    config = buildMonthly(mode, noteId);
                    if (/^(?:(?:bridal|fashion)_)?(?:sales|customers|unit_price)$/.test(mode)) {
                        note.textContent = '売上・客数・客単価は出納帳を優先します。全コースを確認できた月はペアリングを含む総計、出納帳が不足する月は従来の集計値です。未取得の内訳は空欄です。';
                    } else if (mode === 'bridal_cpa') {
                        note.textContent = data.bridal_cpa_trend.note;
                    }
                }
                if (data.meta?.monthly_history_note) note.textContent += ' ' + data.meta.monthly_history_note;
            } else {
                const comparison = comparisonSelector?.value === 'mom' ? 'mom' : 'yoy';
                const comparisonLabel = comparison === 'mom' ? '前月' : '前年';
                config = buildIntervalConfig(data.daily_trend, period, mode, comparison);
                const daily = data.daily_trend;
                const accepted = mode.startsWith('new_');
                const basis = accepted
                    ? '受付日ベース・キャンセル除外。' + shortDate(daily.accepted_through) + 'まで集計（' + comparisonLabel + 'も同日まで）。'
                    : mode === 'reservations'
                        ? '予約日ベース・キャンセル込み。取得時点の月末までの予約予定を含みます。'
                        : '予約日ベース・キャンセル除外。取得時点の月末までの予約予定を含みます。';
                note.textContent = daily.month.replace('-', '年') + '月 ／ ' + basis
                    + (period === 'weekly' ? '週は月曜〜日曜、月初・月末は月内分のみ。' : '')
                    + comparisonLabel + '（' + (comparison === 'mom' ? daily.previous_month : daily.previous_year + '-' + daily.month.slice(5)) + '）の同じ日付範囲で比較（曜日は異なります）。存在しない日付は空欄。取得 ' + daily.as_of
                    + '。売上・客数・客単価・固定掲載費込みの費用とCPAは月次のみ。';
                if (daily.monthly_totals_differ?.includes(mode)) note.textContent += '日次・週次は取得時点の予約履歴による再集計です。保存済みの月次集計とは合計が異なります。';
                if (comparison !== 'mom' && daily.previous_reservations.every(v => v === null)) note.textContent += '前年同月は開業前のため比較なし。';
            }
            canvas.setAttribute('aria-label', title.textContent + '：' + selector.selectedOptions[0].textContent + (isMonthly ? '' : '（比較：' + (comparisonSelector?.value === 'mom' ? '前月' : '前年同月') + '）'));
            if (chart) chart.destroy();
            chart = new root.Chart(canvas.getContext('2d'), config);
        }
        periodSelector.addEventListener('change', () => {
            modes[lastPeriod] = selector.value;
            const next = periodSelector.value;
            // Keep the current reservation metric when first switching to a finer interval.
            if (next !== 'monthly' && [...reservationModes,...mediaModes].includes(selector.value)) {
                modes[next] = selector.value;
            }
            selector.value = modes[next];
            lastPeriod = next;
            render();
        });
        comparisonSelector?.addEventListener('change', () => {
            if (periodSelector.value !== 'monthly') render();
        });
        selector.addEventListener('change', render);
        render();
    }
    root.KamakuraTrends = {init, buckets, buildIntervalConfig, buildCostConfig, buildMediaConfig};
    if (typeof module !== 'undefined' && module.exports) module.exports = root.KamakuraTrends;
})(typeof window !== 'undefined' ? window : globalThis);
