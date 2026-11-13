import json
import io
import os
import hashlib
import tempfile
import unittest

from backend import app as planify
from backend import syllabus_intelligence as intelligence


class SyllabusIntelligenceTests(unittest.TestCase):
    def setUp(self):
        planify.app.config['TESTING'] = True
        self.db = tempfile.NamedTemporaryFile(suffix='.db', delete=False)
        self.db.close()
        planify.DB_PATH = self.db.name
        planify.create_tables()
        self.client = planify.app.test_client()
        self.client.post('/register', json={
            'name': 'Syllabus User', 'email': 'syllabus@example.com',
            'password': 'StrongPass1!', 'education_level': 'B.Tech CSE',
        })
        login = self.client.post('/login', json={'email': 'syllabus@example.com', 'password': 'StrongPass1!'})
        self.headers = {'Authorization': f"Bearer {login.get_json()['token']}"}
        conn = planify.get_db()
        self.student_id = conn.execute('SELECT student_id FROM students WHERE email=?', ('syllabus@example.com',)).fetchone()['student_id']
        conn.close()

    def tearDown(self):
        os.unlink(self.db.name)

    def _insert_pending_syllabus(self, structure):
        conn = planify.get_db()
        cursor = conn.execute("""
            INSERT INTO syllabus_documents (student_id, original_filename, content_hash, source_type, status, extracted_json)
            VALUES (?, 'complete-syllabus.txt', 'hash', 'txt', 'pending_review', ?)
        """, (self.student_id, json.dumps(structure)))
        syllabus_id = cursor.lastrowid
        conn.commit()
        conn.close()
        return syllabus_id

    def test_confirmed_syllabus_is_optional_reference_and_preserves_user_topic(self):
        saved = self.client.post('/save-subjects', headers=self.headers, json={'subjects': [{
            'name': 'Physics', 'difficulty': 'Medium', 'examDate': '2030-01-01',
            'topics': [{'name': 'Current Electricity'}, {'name': 'Thermodynamics'}],
        }]})
        self.assertEqual(saved.status_code, 200)
        structure = {'subjects': [{'name': 'Physics', 'units': [{'name': 'Unit 1', 'chapters': [{
            'name': 'Electricity', 'topics': ['Current Electricity'],
        }]}]}], 'uncertainties': []}
        syllabus_id = self._insert_pending_syllabus(structure)

        confirmed = self.client.post('/syllabus/confirm', headers=self.headers, json={'syllabusId': syllabus_id})
        self.assertEqual(confirmed.status_code, 200)
        state = self.client.get('/syllabus/intelligence', headers=self.headers)
        self.assertEqual(state.status_code, 200)
        manual_subject = state.get_json()['manualSubjects'][0]
        self.assertTrue(manual_subject['inSyllabus'])
        self.assertTrue(manual_subject['topics'][0]['inSyllabus'])
        self.assertFalse(manual_subject['topics'][1]['inSyllabus'])

        plan = self.client.post('/generate-plan', headers=self.headers, json={'sleepHours': 8})
        self.assertEqual(plan.status_code, 200)
        warnings = plan.get_json()['syllabusWarnings']
        self.assertEqual(warnings[0]['topic'], 'Thermodynamics')
        # The unmatched student topic remains part of the existing workflow.
        self.assertIn('Thermodynamics', [topic['name'] for topic in plan.get_json()['plan'][0]['topics']])

    def test_confirmation_rejects_complete_syllabus_missing_existing_subject(self):
        self.client.post('/save-subjects', headers=self.headers, json={'subjects': [{
            'name': 'Physics', 'difficulty': 'Medium', 'examDate': '2030-01-01', 'topics': [{'name': 'Optics'}],
        }]})
        structure = {'subjects': [{'name': 'Chemistry', 'units': [{'name': 'Unit 1', 'chapters': [{
            'name': 'Matter', 'topics': ['Atoms'],
        }]}]}], 'uncertainties': []}
        syllabus_id = self._insert_pending_syllabus(structure)
        response = self.client.post('/syllabus/confirm', headers=self.headers, json={'syllabusId': syllabus_id})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.get_json()['missingSubjects'], ['Physics'])

    def test_identical_pending_syllabus_reuses_review_without_another_ai_call(self):
        raw = b'Physics syllabus: Current Electricity and Magnetism.'
        structure = {'subjects': [{'name': 'Physics', 'units': [{'name': 'Unit 1', 'chapters': [{
            'name': 'Electricity', 'topics': ['Current Electricity'],
        }]}]}], 'uncertainties': []}
        conn = planify.get_db()
        cursor = conn.execute("""
            INSERT INTO syllabus_documents (student_id, original_filename, content_hash, source_type, status, extracted_json)
            VALUES (?, 'syllabus.txt', ?, 'txt', 'pending_review', ?)
        """, (self.student_id, hashlib.sha256(raw).hexdigest(), json.dumps(structure)))
        pending_id = cursor.lastrowid
        conn.commit()
        conn.close()
        original_key, original_analysis = planify.GEMINI_API_KEY, planify.syllabus_intelligence.run_ai_analysis
        planify.GEMINI_API_KEY = 'test-key'
        planify.syllabus_intelligence.run_ai_analysis = lambda *_args: self.fail('Duplicate syllabus must not call Gemini')
        try:
            response = self.client.post('/syllabus/analyze', headers=self.headers, data={
                'file': (io.BytesIO(raw), 'syllabus.txt'),
            }, content_type='multipart/form-data')
        finally:
            planify.GEMINI_API_KEY, planify.syllabus_intelligence.run_ai_analysis = original_key, original_analysis
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()['reusedAnalysis'])
        self.assertEqual(response.get_json()['analysisId'], pending_id)

    def test_confirming_updated_syllabus_supersedes_the_previous_version(self):
        first = {'subjects': [{'name': 'Physics', 'units': [{'name': 'Unit 1', 'chapters': [{
            'name': 'Mechanics', 'topics': ['Motion'],
        }]}]}], 'uncertainties': []}
        second = {'subjects': [{'name': 'Physics', 'units': [{'name': 'Unit 1', 'chapters': [{
            'name': 'Mechanics', 'topics': ['Motion', 'Force'],
        }]}]}], 'uncertainties': []}
        first_id = self._insert_pending_syllabus(first)
        second_id = self._insert_pending_syllabus(second)
        self.assertEqual(self.client.post('/syllabus/confirm', headers=self.headers, json={'syllabusId': first_id}).status_code, 200)
        self.assertEqual(self.client.post('/syllabus/confirm', headers=self.headers, json={'syllabusId': second_id}).status_code, 200)

        conn = planify.get_db()
        statuses = {row['syllabus_id']: row['status'] for row in conn.execute(
            'SELECT syllabus_id, status FROM syllabus_documents WHERE student_id=?', (self.student_id,)
        )}
        conn.close()
        self.assertEqual(statuses[first_id], 'superseded')
        self.assertEqual(statuses[second_id], 'confirmed')
        current = self.client.get('/syllabus/intelligence', headers=self.headers).get_json()
        self.assertEqual(current['syllabusId'], second_id)
        self.assertEqual(current['summary']['topicCount'], 2)

    def test_priority_signal_is_bounded_and_enriches_existing_planner_data(self):
        structure = {'subjects': [{'name': 'Physics', 'units': [{'name': 'Unit 1', 'chapters': [{
            'name': 'Electricity', 'topics': ['Current Electricity'],
        }]}]}], 'uncertainties': []}
        syllabus_id = self._insert_pending_syllabus(structure)
        self.client.post('/syllabus/confirm', headers=self.headers, json={'syllabusId': syllabus_id})
        conn = planify.get_db()
        topic_id = conn.execute('SELECT syllabus_topic_id FROM syllabus_topic_map WHERE syllabus_id=?', (syllabus_id,)).fetchone()['syllabus_topic_id']
        conn.execute("""
            INSERT INTO topic_priority_signals (student_id, syllabus_topic_id, pyq_frequency, importance, priority_signal, evidence_json)
            VALUES (?, ?, 99, 'high', 2, '[]')
        """, (self.student_id, topic_id))
        subjects, warnings = planify._apply_syllabus_intelligence(conn, self.student_id, [{
            'name': 'Physics', 'difficulty': 'Medium', 'examDate': '2030-01-01',
            'topics': [{'name': 'Current Electricity'}, {'name': 'Other Topic'}],
        }])
        conn.close()
        self.assertEqual(subjects[0]['topics'][0]['prioritySignal'], 2.0)
        self.assertTrue(subjects[0]['topics'][0]['syllabusConfirmed'])
        self.assertEqual(subjects[0]['topics'][1]['prioritySignal'], 0.0)
        self.assertEqual(warnings[0]['topic'], 'Other Topic')

    def test_canonical_extractors_never_accept_topics_outside_confirmed_catalog(self):
        structure = intelligence.canonical_syllabus({'subjects': [{'name': 'Physics', 'units': [{'name': 'Unit', 'chapters': [{
            'name': 'Chapter', 'topics': ['Optics'],
        }]}]}]})
        catalog = intelligence.flatten_syllabus(structure)
        analysed = intelligence.canonical_pyq({'mappings': [
            {'subject': 'Physics', 'topic': 'Optics', 'frequency': 2, 'importance': 'high', 'evidence': ['Lens question']},
            {'subject': 'Physics', 'topic': 'Invented Topic', 'frequency': 50, 'importance': 'high'},
        ]}, catalog)
        self.assertEqual(len(analysed['mappings']), 1)
        self.assertEqual(analysed['mappings'][0]['topic'], 'Optics')

    def test_pyq_upload_maps_only_confirmed_topic_and_returns_priority_signal(self):
        structure = {'subjects': [{'name': 'Physics', 'units': [{'name': 'Unit 1', 'chapters': [{
            'name': 'Electricity', 'topics': ['Current Electricity'],
        }]}]}], 'uncertainties': []}
        syllabus_id = self._insert_pending_syllabus(structure)
        self.assertEqual(self.client.post('/syllabus/confirm', headers=self.headers, json={'syllabusId': syllabus_id}).status_code, 200)

        original_key, original_analysis = planify.GEMINI_API_KEY, planify.syllabus_intelligence.run_ai_analysis
        ai_calls = []
        planify.GEMINI_API_KEY = 'test-key'
        def fake_analysis(*_args):
            ai_calls.append(True)
            return {
                'mappings': [{
                    'subject': 'Physics', 'topic': 'Current Electricity', 'frequency': 2,
                    'importance': 'high', 'evidence': ['Kirchhoff laws question'],
                }, {
                    'subject': 'Physics', 'topic': 'Invented Topic', 'frequency': 50, 'importance': 'high',
                }],
                'unmappedQuestionCount': 1, 'uncertainties': [],
            }
        planify.syllabus_intelligence.run_ai_analysis = fake_analysis
        try:
            response = self.client.post('/syllabus/pyq', headers=self.headers, data={
                'label': 'University 2025',
                'files': (io.BytesIO(b'Current Electricity: Explain Kirchhoff laws.'), 'paper.txt'),
            }, content_type='multipart/form-data')
            duplicate = self.client.post('/syllabus/pyq', headers=self.headers, data={
                'files': (io.BytesIO(b'Current Electricity: Explain Kirchhoff laws.'), 'same-paper.txt'),
            }, content_type='multipart/form-data')
        finally:
            planify.GEMINI_API_KEY, planify.syllabus_intelligence.run_ai_analysis = original_key, original_analysis
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['mappedTopics'], 1)
        self.assertEqual(len(ai_calls), 1)
        self.assertEqual(duplicate.status_code, 409)
        self.assertEqual(len(ai_calls), 1)
        intelligence_state = self.client.get('/syllabus/intelligence', headers=self.headers).get_json()
        insights = intelligence_state['prioritySignals']
        self.assertEqual(insights[0]['topic_name'], 'Current Electricity')
        self.assertEqual(insights[0]['pyq_frequency'], 2)
        self.assertEqual(len(intelligence_state['pyqDocuments']), 1)

        removed = self.client.delete(f"/syllabus/pyq/{intelligence_state['pyqDocuments'][0]['pyqId']}", headers=self.headers)
        self.assertEqual(removed.status_code, 200)
        after_removal = self.client.get('/syllabus/intelligence', headers=self.headers).get_json()
        self.assertEqual(after_removal['prioritySignals'], [])
        self.assertEqual(after_removal['pyqDocuments'], [])

    def test_pyq_batch_limit_is_enforced_before_ai_analysis(self):
        structure = {'subjects': [{'name': 'Physics', 'units': [{'name': 'Unit 1', 'chapters': [{
            'name': 'Electricity', 'topics': ['Current Electricity'],
        }]}]}], 'uncertainties': []}
        syllabus_id = self._insert_pending_syllabus(structure)
        self.assertEqual(self.client.post('/syllabus/confirm', headers=self.headers, json={'syllabusId': syllabus_id}).status_code, 200)

        files = [(io.BytesIO(b'Current Electricity question.'), f'paper-{index}.txt') for index in range(6)]
        response = self.client.post('/syllabus/pyq', headers=self.headers, data={'files': files}, content_type='multipart/form-data')
        self.assertEqual(response.status_code, 400)
        self.assertIn('1 and 5', response.get_json()['error'])
        self.assertEqual(planify.app.config['MAX_CONTENT_LENGTH'], intelligence.MAX_REQUEST_BYTES)


if __name__ == '__main__':
    unittest.main()
