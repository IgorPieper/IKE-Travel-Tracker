import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from src import atlas


class SavedPresetSettingsTests(unittest.TestCase):
    def test_new_presets_default_off_and_keep_explicit_saved_choices(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(atlas, 'SETTINGS', Path(folder)/'settings.csv'):
            # An older installation has no rows for either new preset.
            atlas.write_csv(atlas.SETTINGS, atlas.SETTINGS_FIELDS, [
                {'widok': 'countries', 'widoczny': 1}, {'widok': 'visited', 'widoczny': 0},
                {'widok': 'language', 'wartosc': 'pl'},
            ])
            ranges, visibility, layout = atlas.read_settings()
            for preset in ('visited-only', 'planned-only'):
                self.assertFalse(visibility[preset])
                self.assertEqual(ranges[preset], ranges['visited'])
            self.assertFalse(visibility['visited'])
            self.assertEqual(layout['language'], 'pl')
            visibility['planned-only'] = True
            atlas.write_settings(ranges, visibility, layout)
            _, saved, saved_layout = atlas.read_settings()
            self.assertTrue(saved['planned-only'])
            self.assertFalse(saved['visited-only'])
            self.assertEqual(saved_layout['language'], 'pl')


if __name__ == '__main__':
    unittest.main()
