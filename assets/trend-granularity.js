/* Daily counts are aggregated from the same reservation snapshot as the monthly report. */
(function (root) {
    'use strict';
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

    function buildIntervalConfig(daily, period, mode) {
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
        const datasets = metrics.flatMap(metric => ['current', 'previous'].map(prefix => ({
            label: (prefix === 'current' ? '当年 ' : '前年同期間 ') + metric.label,
            data: ranges.map(range => total(prefix + '_' + metric.key, range.indices)),
            borderColor: prefix === 'previous' && !split ? '#94a3b8' : metric.color,
            backgroundColor: metric.color,
            borderDash: prefix === 'previous' ? [5, 5] : [],
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
                        return range.partial ? shortDate(range.observedEnd) + 'まで集計（前年も同じ日付範囲）' : '';
                    },
                    label(context) { return context.dataset.label + ': ' + context.parsed.y.toLocaleString() + '件'; }
                }}}
            }
        };
    }

    function init({data, selectorId, noteId, canvasId, initialMode, buildMonthly}) {
        const selector = document.getElementById(selectorId);
        const periodSelector = document.getElementById(selectorId + 'Period');
        const title = document.getElementById(selectorId + 'Title');
        const note = document.getElementById(noteId);
        const canvas = document.getElementById(canvasId);
        const options = Array.from(selector.options).map(option => ({option, disabled: option.disabled, text: option.textContent}));
        const selected = options.find(item => item.option.value === initialMode && !item.disabled);
        if (selected) selector.value = initialMode;
        const modes = {monthly: selector.value, daily: 'new_reservations', weekly: 'new_reservations'};
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
                const monthlyOnly = !reservationModes.includes(option.value);
                option.disabled = isMonthly ? disabled : monthlyOnly;
                option.textContent = text + (!isMonthly && monthlyOnly ? '（月次のみ）' : '');
            });
            if (selector.selectedOptions[0].disabled) selector.value = 'new_reservations';
            const mode = selector.value;
            let config;
            if (isMonthly) {
                config = buildMonthly(mode, noteId);
            } else {
                config = buildIntervalConfig(data.daily_trend, period, mode);
                const daily = data.daily_trend;
                const accepted = mode.startsWith('new_');
                const basis = accepted
                    ? '受付日ベース・キャンセル除外。' + shortDate(daily.accepted_through) + 'まで集計（前年も同日まで）。'
                    : mode === 'reservations'
                        ? '予約日ベース・キャンセル込み。取得時点の月末までの予約予定を含みます。'
                        : '予約日ベース・キャンセル除外。取得時点の月末までの予約予定を含みます。';
                note.textContent = daily.month.replace('-', '年') + '月 ／ ' + basis
                    + (period === 'weekly' ? '週は月曜〜日曜、月初・月末は月内分のみ。' : '')
                    + '前年は同じ日付範囲で比較（曜日は異なります）。取得 ' + daily.as_of
                    + '。売上・客数・客単価・CPAは月次のみ。';
                if (daily.previous_reservations.every(v => v === null)) note.textContent += '前年同月は開業前のため比較なし。';
            }
            canvas.setAttribute('aria-label', title.textContent + '：' + selector.selectedOptions[0].textContent);
            if (chart) chart.destroy();
            chart = new root.Chart(canvas.getContext('2d'), config);
        }
        periodSelector.addEventListener('change', () => {
            modes[lastPeriod] = selector.value;
            const next = periodSelector.value;
            // Keep the current reservation metric when first switching to a finer interval.
            if (next !== 'monthly' && reservationModes.includes(selector.value)) {
                modes[next] = selector.value;
            }
            selector.value = modes[next];
            lastPeriod = next;
            render();
        });
        selector.addEventListener('change', render);
        render();
    }
    root.KamakuraTrends = {init, buckets, buildIntervalConfig};
    if (typeof module !== 'undefined' && module.exports) module.exports = root.KamakuraTrends;
})(typeof window !== 'undefined' ? window : globalThis);
