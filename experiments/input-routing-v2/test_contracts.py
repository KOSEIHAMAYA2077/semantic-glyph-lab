import unittest

from contracts import SchemaError, V1, action, description, edit, summarize_current


class StageContractTests(unittest.TestCase):
    def test_one_action_only(self):
        for name in ("new", "edit", "keep"):
            self.assertEqual(action('{"action":"'+name+'"}')["action"], name)
        for raw in ('{"action":"edit","target":null}', '{"action":[]}', '{"action":"create"}'):
            with self.assertRaises(SchemaError):action(raw)

    def test_patch_only_and_finite_bounds(self):
        self.assertEqual(edit('{"changes":{"roughness":0,"count":8}}')["changes"]["count"], 8)
        for raw in ('{"changes":{}}', '{"changes":{"count":true}}', '{"changes":{"bend":NaN}}',
                    '{"changes":{"count":2.0}}', '{"changes":{"size":2}}', '{"changes":{"twist":1.1}}'):
            with self.assertRaises(SchemaError):edit(raw)

    def test_description_is_unknown_object_not_catalog_or_code(self):
        self.assertEqual(description('{"text_en":"a funnel"}')["text_en"], "a funnel")
        for raw in ('{"text_en":""}', '{"text_en":"傘"}', '{"text_en":"a lamp","form":"tower"}',
                    '{"code":"print(1)"}', '{"text_en":123}'):
            with self.assertRaises(SchemaError):description(raw)

    def test_duplicate_unicode_size_and_non_json(self):
        for raw in ('{"action":"new","action":"keep"}', '\ud800', 'x'*4097,
                    '<think>x</think>{"action":"keep"}', '[{"action":"keep"}]'):
            with self.assertRaises(SchemaError):action(raw)

    def test_context_has_current_subject_but_no_catalog(self):
        current = {"target":{"form":None,"object_en":"a watering can"},"attributes":V1.DEFAULTS}
        result = summarize_current(current)
        self.assertEqual(set(result), {"subject_en","attributes"})
        self.assertEqual(result["subject_en"], "a watering can")


if __name__ == "__main__":unittest.main()
