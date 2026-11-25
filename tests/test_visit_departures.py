import copy
import io
import json
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from urllib.request import Request, urlopen
from src import atlas
from src.journal_export import date_label, build_journal
from test_journal_export import fixture

REPEAT = '22222222-2222-4222-8222-222222222222'


class VisitDepartureTests(unittest.TestCase):
    def test_return_visits_do_not_inherit_the_first_departure(self):
        details = atlas.visit_details({'data':'2026-01-01','data_konca':'2026-01-03','data_konca_niepewna':True,
            'kolejne_wizyty':[{'id':REPEAT,'data':'2025-01-01'},
                {'id':'33333333-3333-4333-8333-333333333333','data':'2025-06-01','data_konca':'2025-06-04','data_konca_niepewna':True}]})
        rows = atlas.diary_visits([{'kategoria':'miasto','id':'osm:test',**details}])
        self.assertEqual(rows['miasto:osm:test']['data_konca'],'2026-01-03')
        self.assertEqual(rows['miasto:osm:test:visit:'+REPEAT]['data_konca'],'')
        self.assertEqual(rows['miasto:osm:test:visit:'+REPEAT]['data_konca_niepewna'],'')
        last = rows['miasto:osm:test:visit:33333333-3333-4333-8333-333333333333']
        self.assertEqual((last['data_konca'],last['data_konca_niepewna']),('2025-06-04','1'))
        for dates in ({'data':'2026-01-03','data_konca':'2026-01-02'},
                      {'kolejne_wizyty':[{'id':REPEAT,'data':'2025-01-02','data_konca':'2025-01-01'}]}):
            with self.assertRaises(ValueError): atlas.visit_details(dates)

    def test_pin_and_place_apis_persist_departure_dates(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(atlas,'CSV',Path(folder)/'progress.csv'):
            with atlas.AtlasServer(('127.0.0.1',0),atlas.App) as server:
                country={'kategoria':'panstwo','id':'pl','nazwa':'Polska'}
                server.places={('panstwo','pl'):country};server.countries={'pl':country}
                server.country_codes={'PL':'pl'};server.continents_by_country={};server.continent_territories={}
                thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
                address=f'http://127.0.0.1:{server.server_port}'
                dates={'data':'2026-01-01','data_konca':'2026-01-05','data_niepewna':True,'data_konca_niepewna':True,
                       'kolejne_wizyty':[{'id':REPEAT,'data':'2025-02-01','data_konca':'2025-02-04','data_konca_niepewna':True}]}
                payloads=[('/api/odwiedzone',{'kategoria':'panstwo','id':'pl','odwiedzone':True,**dates}),
                    ('/api/pinezki',{'id':'11111111-1111-4111-8111-111111111111','nazwa':'QA pin','pozycja':[0,0],
                                    'opis_dlugi':'','kolor':'#ff0000',**dates})]
                try:
                    for endpoint,payload in payloads:
                        req=Request(address+endpoint,data=json.dumps(payload).encode(),headers={'Origin':address,'Content-Type':'application/json'})
                        with urlopen(req) as response: saved=json.load(response)[0]
                        self.assertEqual((saved['data'],saved['data_konca'],saved['data_konca_niepewna']),('2026-01-01','2026-01-05','1'))
                        self.assertEqual(saved['kolejne_wizyty'][0]['data_konca'],'2025-02-04')
                    stored=atlas.read_visits()
                    self.assertEqual(len(stored),2)
                    for format in ('csv','json'):
                        content=atlas.export_progress(stored,format,server)[0].decode('utf-8-sig')
                        restored=atlas.import_progress(content,format,server)
                        self.assertEqual(restored,stored)
                finally: server.shutdown();thread.join()

    def test_journal_order_and_years_depend_on_arrival_only(self):
        server,rows=fixture();before=atlas.journal_model(rows,server,'en')
        changed=copy.deepcopy(rows)
        for row in changed:
            if row['kategoria'] in ('miasto','pinezka') and row.get('tryb')!='plan':
                row.update(data_konca='2099-12-31',data_niepewna='1',data_konca_niepewna='1')
        after=atlas.journal_model(changed,server,'en')
        identity=lambda model:[(y,[(e['title'],e['date']) for e in entries]) for y,entries in model['years']]
        self.assertEqual(identity(before),identity(after))
        members=after['years'][0][1][0]['members']
        self.assertEqual(date_label(members[0],after),'Undated')
        self.assertEqual(date_label(members[1],after),'Undated')
        # With no arrival, a departure must not move a visit into a dated year.
        pin=next(e for year,entries in after['years'] if not year for e in entries)
        self.assertEqual(pin['date'],'')

    def test_departure_ranges_and_undated_are_in_pdf_and_word(self):
        server,rows=fixture()
        for row in rows:
            if row['id']=='osm:1': row.update(data_konca='2026-08-06',data_konca_niepewna='1')
            if row['id']=='osm:2': row.update(data_konca='2026-08-11',data_niepewna='1',data_konca_niepewna='1')
        model=atlas.journal_model(rows,server,'en')
        for format in ('pdf','docx'):
            data=build_journal(model,atlas.country_shapes(),format)
            if format=='pdf':
                from pypdf import PdfReader
                text='\n'.join(p.extract_text() for p in PdfReader(io.BytesIO(data)).pages)
            else:
                from docx import Document
                text='\n'.join(p.text for p in Document(io.BytesIO(data)).paragraphs)
            self.assertIn('~6 August 2026',text)
            self.assertIn('Undated',text)

if __name__=='__main__': unittest.main()
