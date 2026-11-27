import csv
import io
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from src import atlas
from src.journal_export import date_label


class TripDatesTests(unittest.TestCase):
    def test_single_visit_trip_saves_independent_uncertain_dates(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(atlas, 'CSV', Path(folder)/'visits.csv'):
            atlas.write_visits([{'kategoria':'panstwo','id':'pl','nazwa':'Polska'}])
            change={'id':'11111111-1111-4111-8111-111111111111','nazwa':'Solo',
                    'data':'2026-01-01','data_konca':'2026-01-02','notatka':'',
                    'data_niepewna':True,'data_konca_niepewna':False,'miejsca':['panstwo:pl']}
            app=SimpleNamespace(send_diary=lambda rows:None)
            atlas.App.update_diary(app,change)
            trip=next(row for row in atlas.read_visits() if row['kategoria']=='wycieczka')
            self.assertEqual(atlas.trip_members(trip),['panstwo:pl'])
            self.assertEqual((trip['data_niepewna'],trip['data_konca_niepewna']),('1',''))
            change.update(data_niepewna=False,data_konca_niepewna=True)
            atlas.App.update_diary(app,change)
            trip=next(row for row in atlas.read_visits() if row['kategoria']=='wycieczka')
            self.assertEqual((trip['data_niepewna'],trip['data_konca_niepewna']),('','1'))

    def test_planned_places_can_join_trips_without_counting_as_visited(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(atlas, 'CSV', Path(folder)/'visits.csv'):
            atlas.write_visits([{'kategoria':'panstwo','id':'pl','nazwa':'Polska','tryb':'plan','data':'2027-01-01'}])
            change={'id':'11111111-1111-4111-8111-111111111111','nazwa':'Next year',
                    'data':'2027-01-01','data_konca':'','notatka':'','miejsca':['panstwo:pl']}
            result=[]
            app=SimpleNamespace(send_diary=lambda rows:result.extend(rows))
            atlas.App.update_diary(app,change)
            self.assertEqual(atlas.diary_visits(result), {})
            self.assertIn('panstwo:pl', atlas.diary_visits(result, include_planned=True))
            trip=next(row for row in result if row['kategoria']=='wycieczka')
            self.assertEqual(atlas.trip_members(trip), ['panstwo:pl'])
            self.assertEqual(next(row for row in result if row['kategoria']=='panstwo')['tryb'], 'plan')
            server=SimpleNamespace(country_codes={'PL':'pl'}, countries={'pl':{}}, places={}, city_codes={})
            model=atlas.journal_model(result, server, include_planned=True)
            self.assertIn('Planned', model['years'][0][1][0]['members'][0]['title'])
            self.assertEqual(model['countries'], 0)

    def test_legacy_backup_without_either_uncertainty_column_imports(self):
        fields=[f for f in atlas.FIELDS if f not in ('data_niepewna','data_konca_niepewna')]
        output=io.StringIO(newline='');writer=csv.DictWriter(output,fields)
        writer.writeheader();writer.writerow({'kategoria':'panstwo','id':'pl','nazwa':'Polska'})
        server=SimpleNamespace(places={('panstwo','pl'):{}},countries={'pl':{}})
        row=atlas.import_progress(output.getvalue(),'csv',server)[0]
        self.assertEqual((row['data_niepewna'],row['data_konca_niepewna']),('',''))

    def test_export_marks_each_endpoint_independently_including_same_day(self):
        model={'language':'en'}
        entry={'kind':'trip','date':'2026-01-01','end':'2026-01-02','uncertain':True,'end_uncertain':False}
        self.assertEqual(date_label(entry,model),'~1 January 2026 - 2 January 2026')
        entry.update(uncertain=False,end_uncertain=True)
        self.assertEqual(date_label(entry,model),'1 January 2026 - ~2 January 2026')
        entry['end']=entry['date']
        self.assertEqual(date_label(entry,model),'1 January 2026 - ~1 January 2026')

if __name__=='__main__': unittest.main()
