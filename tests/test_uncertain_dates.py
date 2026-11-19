import copy
import csv
import io
import json
import unittest
import tempfile
import threading
from pathlib import Path
from unittest.mock import patch
from urllib.request import Request, urlopen
from types import SimpleNamespace

from src import atlas
from src.journal_export import date_label, build_journal
from test_journal_export import fixture


class UncertainDateTests(unittest.TestCase):
    def test_pin_api_persists_primary_and_return_visit_flags_independently(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(atlas, 'CSV', Path(folder)/'progress.csv'):
            with atlas.AtlasServer(('127.0.0.1',0),atlas.App) as server:
                thread=threading.Thread(target=server.serve_forever,daemon=True)
                thread.start()
                address=f'http://127.0.0.1:{server.server_port}'
                payload={'id':'11111111-1111-4111-8111-111111111111','nazwa':'Test pin','pozycja':[0,0],
                         'opis_dlugi':'','kolor':'#ff0000','data':'2026-01-01','data_niepewna':True,
                         'kolejne_wizyty':[{'id':'22222222-2222-4222-8222-222222222222','data':'2025-01-01','data_niepewna':False}]}
                try:
                    for main,repeat in ((True,False),(False,True)):
                        payload['data_niepewna']=main
                        payload['kolejne_wizyty'][0]['data_niepewna']=repeat
                        request=Request(address+'/api/pinezki',data=json.dumps(payload).encode(),
                                        headers={'Origin':address,'Content-Type':'application/json'})
                        with urlopen(request) as response:
                            saved=json.load(response)[0]
                        self.assertEqual(saved['data'],'2026-01-01')
                        self.assertEqual(saved['data_niepewna'],'1' if main else '')
                        self.assertEqual(saved['kolejne_wizyty'][0]['data_niepewna'],repeat)
                        stored=atlas.read_visits()[0]
                        self.assertEqual(stored['data_niepewna'],'1' if main else '')
                finally:
                    server.shutdown()
                    thread.join()

    def test_flags_are_separate_from_validated_dates(self):
        details = atlas.visit_details({'data':'2026-01-02','data_niepewna':True})
        self.assertEqual(details, {'data':'2026-01-02','data_niepewna':'1'})
        self.assertEqual(atlas.visit_details({'data_niepewna':False}), {'data_niepewna':''})
        for flag in ('yes', 'true', 2, [], None):
            with self.subTest(flag=flag), self.assertRaises(ValueError):
                atlas.visit_details({'data_niepewna':flag})
        with self.assertRaises(ValueError):
            atlas.visit_details({'data':'~2026-01-02','data_niepewna':True})

    def test_return_visits_keep_independent_precision(self):
        repeat='22222222-2222-4222-8222-222222222222'
        second='33333333-3333-4333-8333-333333333333'
        details=atlas.visit_details({'data':'2026-01-01','data_niepewna':True,'kolejne_wizyty':[
            {'id':repeat,'data':'2025-01-01'}, {'id':second,'data':'2027-01-01','data_niepewna':True}]})
        visits=atlas.diary_visits([{'kategoria':'miasto','id':'osm:test',**details}])
        self.assertEqual(visits['miasto:osm:test']['data_niepewna'],'1')
        self.assertEqual(visits['miasto:osm:test:visit:'+repeat]['data_niepewna'],'')
        self.assertEqual(visits['miasto:osm:test:visit:'+second]['data_niepewna'],'1')
        pin=atlas.pin_record({'pozycja':[0,0],'nazwa':'Pin','opis_dlugi':'','kolor':'#ff0000',
                             'data':'2026-01-01','data_niepewna':True},repeat)
        self.assertEqual(pin['data_niepewna'],'1')

    def test_legacy_csv_without_precision_column_is_still_importable(self):
        fields=[field for field in atlas.FIELDS if field!='data_niepewna']
        output=io.StringIO(newline='')
        writer=csv.DictWriter(output,fields)
        writer.writeheader()
        writer.writerow({'kategoria':'panstwo','id':'pl','nazwa':'Polska','data':'2020-01-02'})
        server=SimpleNamespace(places={('panstwo','pl'):{}},countries={'pl':{}})
        rows=atlas.import_progress(output.getvalue(),'csv',server)
        self.assertEqual(rows[0]['data'],'2020-01-02')
        self.assertEqual(rows[0]['data_niepewna'],'')

    def test_journal_order_stays_the_same_but_export_labels_gain_tildes(self):
        server,rows=fixture()
        original=atlas.journal_model(rows,server,'en')
        changed=copy.deepcopy(rows)
        changed[2]['data_niepewna']='1'
        visits=json.loads(changed[2]['kolejne_wizyty'])
        visits[0]['data_niepewna']=True
        changed[2]['kolejne_wizyty']=json.dumps(visits)
        model=atlas.journal_model(changed,server,'en')
        def ordering(value):
            return [(year,[(entry['kind'],entry['date'],[member['date'] for member in entry.get('members',[])])
                            for entry in entries]) for year,entries in value['years']]
        self.assertEqual(ordering(model),ordering(original))
        warsaw=model['years'][0][1][0]['members'][1]
        self.assertEqual(date_label(warsaw,model),'~4 August 2026')
        self.assertEqual(warsaw['date'],'2026-08-04')
        self.assertEqual(date_label(model['years'][1][1][0],model),'~11 May 2024')
        for format in ('pdf','docx'):
            with self.subTest(format=format):
                data=build_journal(model,atlas.country_shapes(),format)
                if format=='pdf':
                    from pypdf import PdfReader
                    text='\n'.join(page.extract_text() for page in PdfReader(io.BytesIO(data)).pages)
                else:
                    from docx import Document
                    text='\n'.join(p.text for p in Document(io.BytesIO(data)).paragraphs)
                self.assertIn('~4 August 2026',text)
                self.assertIn('~11 May 2024',text)

if __name__=='__main__':
    unittest.main()
