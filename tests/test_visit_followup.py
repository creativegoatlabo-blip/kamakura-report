import sys,unittest,json,re
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
import visit_followup as v
S='鎌倉本店';Y='横浜元町';C=v.COURSES[0]
def visit(no,day,kana='かな',store=S,**kw):
 return dict(no=no,store=store,course='結婚指輪・婚約指輪　ご見学',accepted=day,booked=day,kana=kana,**kw)
def bridal(no,day,kana='かな',store=S,production='2027-01-01',**kw):
 return dict(no=no,store=store,course=C,accepted=day,booked=production,kana=kana,**kw)
def metric(rows,cutoff,days,month='2026-07'):
 r=v.calculate_followup(rows,cutoff);return next(x for x in r['all']['months'] if x['month']==month)[f'days_{days}']
class FollowupTests(unittest.TestCase):
 def test_day_zero_and_inclusive_30_90_boundaries(self):
  for lag,num30,num90 in [(0,1,1),(30,1,1),(31,0,1),(90,0,1),(91,0,0)]:
   from datetime import date,timedelta
   day=(date(2026,7,1)+timedelta(days=lag)).isoformat();rows=[visit(1,'2026-07-01'),bridal(2,day)]
   with self.subTest(lag=lag):
    self.assertEqual(metric(rows,'2026-11-05',30)['converted'],num30)
    self.assertEqual(metric(rows,'2026-11-05',90)['converted'],num90)
 def test_immature_converted_group_is_excluded_from_both_counts(self):
  r=metric([visit(1,'2026-10-31'),bridal(2,'2026-11-01')],'2026-11-05',30,'2026-10')
  self.assertEqual(r,dict(eligible=0,converted=0,pending=1,rate=None,status='tracking'))
 def test_exact_maturity_day_and_month_boundary(self):
  rows=[visit(1,'2026-10-31'),bridal(2,'2026-11-01')]
  self.assertEqual(metric(rows,'2026-11-29',30,'2026-10')['eligible'],0)
  self.assertEqual(metric(rows,'2026-11-30',30,'2026-10')['converted'],1)
  self.assertEqual(metric(rows,'2026-11-30',30,'2026-10')['status'],'complete')
 def test_partial_month_reports_pending_and_complete_month_has_none(self):
  rows=[visit(1,'2026-10-01','a'),visit(2,'2026-10-31','b'),bridal(3,'2026-10-02','a'),bridal(4,'2026-10-31','b')]
  self.assertEqual(metric(rows,'2026-11-05',30,'2026-10'),dict(eligible=1,converted=1,pending=1,rate=100.,status='tracking'))
  self.assertEqual(metric(rows,'2026-11-30',30,'2026-10')['eligible'],2)
 def test_scheduled_visit_month_and_accepted_conversion_date(self):
  r=visit(1,'2026-08-31');r['accepted']='2026-07-01'
  result=metric([r,bridal(2,'2026-09-30',production='2027-04-01')],'2026-11-05',30,'2026-08')
  self.assertEqual(result['converted'],1)
 def test_pre_visit_and_post_cutoff_bookings_are_excluded(self):
  rows=[visit(1,'2026-07-31'),bridal(2,'2026-07-30'),bridal(3,'2026-11-01')]
  self.assertEqual(metric(rows,'2026-10-31',90)['converted'],0)
 def test_production_before_visit_is_ineligible_as_in_existing_rule(self):
  self.assertEqual(metric([visit(1,'2026-07-31'),bridal(2,'2026-08-01',production='2026-07-30')],'2026-11-05',30)['converted'],0)
 def test_cancellations_and_other_courses_are_excluded(self):
  rows=[visit(1,'2026-07-01'),bridal(2,'2026-07-01',cancel=True),visit(3,'2026-07-02','b',cancel=True),bridal(4,'2026-07-03','b')]
  other=bridal(5,'2026-07-04');other['course']='手作りペアリングコース';rows.append(other)
  self.assertEqual(metric(rows,'2026-11-05',30)['converted'],0)
  self.assertEqual(metric(rows,'2026-11-05',30)['eligible'],1)
 def test_cross_store_duplicates_and_partner_identity(self):
  a=visit(1,'2026-07-01',partners=[dict(kana='相手',name='同伴者氏名')]);b=visit(2,'2026-07-10',kana='相手',store=Y)
  r=v.calculate_followup([a,b,bridal(3,'2026-07-31',kana='相手',store=Y)],'2026-11-05')
  self.assertEqual(r['all']['months'][0]['total_groups'],1)
  self.assertEqual(r['stores'][S]['months'][0]['days_30']['converted'],1)
  self.assertEqual(r['stores'][Y]['months'][0]['total_groups'],0)
 def test_future_booking_cannot_bridge_distinct_historical_groups(self):
  a=visit(1,'2026-07-01','a');b=visit(2,'2026-07-02','b');future=bridal(3,'2026-11-01','a',partners=[dict(kana='b')])
  r=v.calculate_followup([a,b,future],'2026-10-31');self.assertEqual(r['all']['months'][0]['total_groups'],2)
 def test_zero_denominator_renders_dash_and_tracking_status(self):
  r=v.calculate_followup([visit(1,'2026-10-31'),bridal(2,'2026-11-01')],'2026-11-05');html=v.render_followup(r)
  self.assertIn('追跡中・暫定',html);self.assertIn('>—</td>',html)
  payload=json.loads(re.search(r'id="visitFollowupData">(.*?)</script>',html)[1]);self.assertIsNone(payload['months'][3]['days_30']['rate'])
  self.assertIn('見学予定日ベース・実来店確認ではありません',html)
 def test_ninety_days_finished_for_july_by_october_end(self):
  r=metric([visit(1,'2026-07-31'),bridal(2,'2026-10-29')],'2026-10-31',90)
  self.assertEqual(r,dict(eligible=1,converted=1,pending=0,rate=100.,status='complete'))
if __name__=='__main__':unittest.main()
