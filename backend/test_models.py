import os
import unittest


class ModelProbingTests(unittest.TestCase):
    @unittest.skipUnless(
        os.getenv('PLANIFY_RUN_LIVE_GEMINI_TESTS') == 'true',
        'Live Gemini probe is opt-in; set PLANIFY_RUN_LIVE_GEMINI_TESTS=true to run it',
    )
    def test_gemini_models(self):
        import google.generativeai as genai
        genai.configure(api_key=os.getenv('GEMINI_API_KEY'))
        models_to_try = [
            'gemini-2.5-flash',
            'gemini-2.5-flash-lite',
            'gemini-2.0-flash-lite',
        ]
        success = False
        for model_name in models_to_try:
            try:
                model = genai.GenerativeModel(model_name)
                # Live provider checks must be bounded; an unavailable model
                # should fail this probe quickly instead of hanging the entire
                # backend suite indefinitely.
                response = model.generate_content("Say 'hello'", request_options={"timeout": 10})
                if response.text:
                    success = True
                    break
            except Exception:
                continue
        self.assertTrue(success)


if __name__ == "__main__":
    unittest.main()
