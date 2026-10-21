const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = filename => JSON.parse(fs.readFileSync(filename, 'utf8').match(/const reportData\s*=\s*(\{.*?\});/s)[1]);
const files = fs.readdirSync('.').filter(f => f.endsWith('.html') && f !== 'index.html');
const reports = files.map(f => [f, read(f)]);
const sum = values => values.reduce((a, v) => a + (v ?? 0), 0);

test('March report includes full April actuals for every requested monthly metric', () => {
    const d = read('all_course_report_2026_03.html');
    assert.equal(d.monthly_trend.current_reservations[11], 662);
    assert.equal(d.new_monthly_trend.current_reservations[11], 621);
    assert.equal(d.sales_trend.sales[11], 51986449);
    assert.equal(d.sales_trend.customers[11], 969);
    assert.equal(d.sales_trend.unit_price[11], 53650);
    assert.equal(d.monthly_cost_trend.current_cost[11], 8888275);
    assert.equal(d.bridal_cpa_trend.current_cpa[11], Math.round(8888275 / d.new_monthly_trend.current_bridal[11]));
    assert.equal(d.summary.current_year.total_reservations, 813, 'selected-month summary stays historical');
});

test('all chart series use exactly twelve fiscal months and retain missing values', () => {
    for (const [filename, d] of reports) {
        for (const key of ['monthly_trend', 'new_monthly_trend', 'sales_trend', 'prev_sales_trend', 'monthly_cost_trend', 'bridal_cpa_trend']) {
            for (const [name, values] of Object.entries(d[key] || {})) {
                if (Array.isArray(values)) assert.equal(values.length, 12, filename + ':' + key + ':' + name);
            }
        }
        if (d.daily_trend.month >= '2026-05') {
            for (const key of ['monthly_trend', 'new_monthly_trend']) {
                for (const [name, values] of Object.entries(d[key])) {
                    if (name.startsWith('current_')) assert.ok(values.slice(6).every(v => v === null), filename + ':' + name);
                }
            }
            assert.ok(d.sales_trend.sales.slice(5).every(v => v === null), filename + ': October sales are not acquired');
        }
    }
});

test('monthly reservation charts reconcile to the existing day-level snapshot for every report', () => {
    for (const [filename, d] of reports) {
        const index = (Number(d.daily_trend.month.slice(5)) + 7) % 12;
        for (const [section, prefix] of [['monthly_trend', ''], ['new_monthly_trend', 'new_']]) {
            for (const metric of ['reservations', 'bridal', 'fashion']) {
                const monthly = d[section]['current_' + metric][index];
                const daily = sum(d.daily_trend['current_' + prefix + metric]);
                if (monthly === null) assert.equal(daily, 0, filename + ': pre-opening month');
                else assert.equal(monthly, daily, filename + ':' + section + ':' + metric);
            }
        }
        assert.deepEqual(d.daily_trend.monthly_totals_differ, [], filename);
    }
});

test('same store and fiscal year share the same acquired monthly history', () => {
    const groups = new Map();
    for (const [filename, d] of reports) {
        const stem = filename.replace(/_2026_\d{2}(?=\.html)/, '');
        const fy = d.daily_trend.month < '2026-05' ? 2025 : 2026;
        const key = stem + ':' + fy;
        const values = Object.fromEntries(['monthly_trend', 'new_monthly_trend', 'sales_trend', 'prev_sales_trend', 'monthly_cost_trend', 'bridal_cpa_trend'].map(k => [k, d[k]]));
        if (groups.has(key)) assert.deepEqual(values, groups.get(key), filename);
        else groups.set(key, values);
    }
});

test('all-store monthly reservations sum to the four stores including bookings accepted before opening', () => {
    const all = read('all_course_report.html');
    const stores = ['kamakura_course_report', 'yokohama_course_report', 'course_report', 'kuramae_course_report'].map(s => read(s + '.html'));
    for (const section of ['monthly_trend', 'new_monthly_trend']) {
        for (const [key, values] of Object.entries(all[section])) {
            if (key === 'labels') continue;
            values.forEach((value, i) => {
                if (value !== null) assert.equal(value, sum(stores.map(s => s[section][key][i])), section + ':' + key + ':' + i);
            });
        }
    }
    assert.equal(stores[3].new_monthly_trend.current_reservations[1], 37);
    assert.equal(stores[3].monthly_trend.current_reservations[1], null);
});

test('source-backed sales totals and unit prices reconcile for all acquired ledger months', () => {
    for (const [filename, d] of reports) {
        for (const section of ['sales_trend', 'prev_sales_trend']) {
            const s = d[section];
            for (let i = 0; i < 12; i++) {
                if (s.bridal_sales[i] === null || s.fashion_sales[i] === null) continue;
                assert.equal(s.sales[i], s.bridal_sales[i] + s.fashion_sales[i], filename + ':' + section + ':' + i);
                assert.equal(s.customers[i], s.bridal_customers[i] + s.fashion_customers[i], filename + ':' + section + ':' + i);
                for (const p of ['', 'bridal_', 'fashion_']) {
                    if (s[p + 'customers'][i] > 0) assert.equal(s[p + 'unit_price'][i], Math.round(s[p + 'sales'][i] / s[p + 'customers'][i]), filename + ':' + section + ':' + p + i);
                }
            }
        }
    }
});
