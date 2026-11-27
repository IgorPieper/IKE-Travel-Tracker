import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from src import atlas


class SharedMapSettingsTests(unittest.TestCase):
    def test_profile_name_is_optional_validated_and_persisted_locally(self):
        for value in ('', 'Igor', '  Żeglarz & rodzina  ', '旅人'):
            self.assertTrue(atlas.valid_layout_value('user_name',value))
            self.assertEqual(self.read_layout({'user_name':value})['user_name'],value.strip())
        for value in ('x'*81,'name\nsecond line','name\x00',123,None,'\ud800'):
            self.assertFalse(atlas.valid_layout_value('user_name',value))
        self.assertEqual(self.read_layout({})['user_name'],'')

    def read_layout(self, values):
        with tempfile.TemporaryDirectory() as folder, patch.object(atlas, 'SETTINGS', Path(folder) / 'settings.csv'):
            atlas.write_csv(atlas.SETTINGS, atlas.SETTINGS_FIELDS,
                            ({'widok': key, 'wartosc': value} for key, value in values.items()))
            return atlas.read_settings()[2]

    def test_map_cannot_be_hidden_or_moved_even_in_old_settings(self):
        for value in ('hidden', 'more', 'top'):
            self.assertEqual(self.read_layout({'nav_map-view': value})['nav_map-view'], 'top')
        self.assertEqual(atlas.LAYOUT_VALUES['nav_map-view'], ('top',))

    def test_shared_detail_setting_preserves_offline_mode_and_canonical_value(self):
        legacy = {'online_focus': 'off', 'online_hewelion': 'off', 'online_castles': 'off'}
        self.assertEqual(self.read_layout(legacy)['online_details'], 'off')
        self.assertEqual(self.read_layout({**legacy, 'online_castles': 'on'})['online_details'], 'on')
        self.assertEqual(self.read_layout({**legacy, 'online_details': 'on'})['online_details'], 'on')
        self.assertEqual(self.read_layout({'online_details': 'off'})['online_details'], 'off')
        for key in legacy:
            self.assertNotIn(key, atlas.DEFAULT_LAYOUT)
