import os
import tempfile
import unittest
from datetime import date, timedelta

from backend import app as planify


class ApiSecurityTests(unittest.TestCase):
    def setUp(self):
        # Keep the suite deterministic; live Gemini verification is opt-in in
        # test_models.py and should never run while exercising API behavior.
        planify.app.config['TESTING'] = True
        self.db = tempfile.NamedTemporaryFile(suffix='.db', delete=False)
        self.db.close()
        planify.DB_PATH = self.db.name
        planify.create_tables()
        self.client = planify.app.test_client()

    def tearDown(self):
        os.unlink(self.db.name)

    def test_login_issues_token_and_protects_user_data(self):
        self.client.post('/register', json={
            'name': 'Test User', 'email': 'test@example.com',
            'password': 'StrongPass1!', 'education_level': 'CSE',
        })
        response = self.client.post('/login', json={
            'email': 'test@example.com', 'password': 'StrongPass1!',
        })
        self.assertEqual(response.status_code, 200)
        token = response.get_json()['token']
        headers = {'Authorization': f'Bearer {token}'}
        self.assertEqual(self.client.get('/get-subjects/test@example.com', headers=headers).status_code, 200)
        self.assertEqual(self.client.get('/get-subjects/other@example.com', headers=headers).status_code, 403)

    def test_sensitive_endpoint_requires_token(self):
        response = self.client.get('/get-subjects/test@example.com')
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.headers['X-Content-Type-Options'], 'nosniff')
        self.assertEqual(response.headers['X-Frame-Options'], 'DENY')
        self.assertTrue(response.headers.get('X-Request-ID'))

    def test_health_check_reports_service_and_database_without_auth(self):
        response = self.client.get('/health')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {
            'status': 'ok', 'service': 'planify-api', 'database': 'ok'
        })
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertTrue(response.headers.get('X-Request-ID'))

    def test_search_discovery_files_are_public_and_reference_canonical_host(self):
        robots = self.client.get('/robots.txt', base_url='https://planify.example.com')
        self.assertEqual(robots.status_code, 200)
        self.assertIn('User-agent: *', robots.get_data(as_text=True))
        self.assertIn('Sitemap: https://planify.example.com/sitemap.xml', robots.get_data(as_text=True))
        self.assertEqual(robots.headers['Cache-Control'], 'public, max-age=3600')

        sitemap = self.client.get('/sitemap.xml', base_url='https://planify.example.com')
        self.assertEqual(sitemap.status_code, 200)
        self.assertIn('<loc>https://planify.example.com/</loc>', sitemap.get_data(as_text=True))
        self.assertIn('application/xml', sitemap.content_type)

    def test_account_export_and_permanent_deletion_require_password_confirmation(self):
        self.client.post('/register', json={
            'name': 'Privacy User', 'email': 'privacy@example.com',
            'password': 'StrongPass1!', 'education_level': 'B.Tech',
        })
        login = self.client.post('/login', json={
            'email': 'privacy@example.com', 'password': 'StrongPass1!',
        })
        headers = {'Authorization': f"Bearer {login.get_json()['token']}"}
        self.client.post('/save-subjects', headers=headers, json={'subjects': [{
            'name': 'Physics', 'difficulty': 'Medium', 'examDate': '2030-01-01',
            'topics': [{'name': 'Optics'}],
        }]})

        exported = self.client.get('/account/export', headers=headers)
        self.assertEqual(exported.status_code, 200)
        data = exported.get_json()
        self.assertEqual(data['profile']['email'], 'privacy@example.com')
        self.assertNotIn('password', data['profile'])
        self.assertEqual(data['subjects'][0]['topics'][0]['topic_name'], 'Optics')
        self.assertEqual(exported.headers['Cache-Control'], 'no-store')

        self.assertEqual(self.client.delete('/account', headers=headers, json={
            'confirmation': 'DELETE', 'currentPassword': 'wrong',
        }).status_code, 403)
        self.assertEqual(self.client.delete('/account', headers=headers, json={
            'confirmation': 'REMOVE', 'currentPassword': 'StrongPass1!',
        }).status_code, 400)
        self.assertEqual(self.client.delete('/account', headers=headers, json={
            'confirmation': 'DELETE', 'currentPassword': 'StrongPass1!',
        }).status_code, 200)
        self.assertEqual(self.client.get('/me', headers=headers).status_code, 401)

    def test_quiz_requires_valid_topics(self):
        self.client.post('/register', json={
            'name': 'Quiz User', 'email': 'quiz@example.com',
            'password': 'StrongPass1!', 'education_level': 'CSE',
        })
        response = self.client.post('/login', json={
            'email': 'quiz@example.com', 'password': 'StrongPass1!',
        })
        headers = {'Authorization': f"Bearer {response.get_json()['token']}"}
        result = self.client.post('/generate-quiz', json={'subjects': []}, headers=headers)
        self.assertEqual(result.status_code, 400)

    def test_quiz_topics_are_validated_before_ai_call(self):
        self.client.post('/register', json={
            'name': 'Topic User', 'email': 'topic@example.com',
            'password': 'StrongPass1!', 'education_level': 'CSE',
        })
        response = self.client.post('/login', json={
            'email': 'topic@example.com', 'password': 'StrongPass1!',
        })
        headers = {'Authorization': f"Bearer {response.get_json()['token']}"}
        result = self.client.post('/generate-quiz', headers=headers, json={
            'subjects': [''],
        })
        self.assertEqual(result.status_code, 400)

    def test_sleep_hours_are_required_for_plan_and_quiz(self):
        self.client.post('/register', json={
            'name': 'Sleep User', 'email': 'sleep@example.com',
            'password': 'StrongPass1!', 'education_level': 'CSE',
        })
        login = self.client.post('/login', json={
            'email': 'sleep@example.com', 'password': 'StrongPass1!',
        })
        headers = {'Authorization': f"Bearer {login.get_json()['token']}"}
        saved = self.client.post('/save-subjects', headers=headers, json={'subjects': [{
            'name': 'Physics', 'difficulty': 'Medium', 'examDate': '2030-01-01',
            'topics': [{'name': 'Optics'}],
        }]})
        self.assertEqual(saved.status_code, 200)

        for sleep_hours in (None, '', '   ', 0, 'not-a-number', 24):
            plan_payload = {} if sleep_hours is None else {'sleepHours': sleep_hours}
            quiz_payload = {'subjects': ['Optics']} if sleep_hours is None else {
                'subjects': ['Optics'], 'sleepHours': sleep_hours,
            }
            self.assertEqual(self.client.post('/generate-plan', headers=headers, json=plan_payload).status_code, 400)
            self.assertEqual(self.client.post('/generate-quiz', headers=headers, json=quiz_payload).status_code, 400)

        valid_plan = self.client.post('/generate-plan', headers=headers, json={'sleepHours': 8})
        self.assertEqual(valid_plan.status_code, 200)
        valid_quiz = self.client.post('/generate-quiz', headers=headers, json={
            'subjects': ['Optics'], 'sleepHours': 8,
        })
        self.assertEqual(valid_quiz.status_code, 200)

    def test_obvious_gibberish_is_rejected_for_subjects_and_quizzes(self):
        self.client.post('/register', json={
            'name': 'Academic User', 'email': 'academic@example.com',
            'password': 'StrongPass1!', 'education_level': 'CSE',
        })
        login = self.client.post('/login', json={
            'email': 'academic@example.com', 'password': 'StrongPass1!',
        })
        headers = {'Authorization': f"Bearer {login.get_json()['token']}"}

        for invalid_text in ('jdfhd', 'asdfgh', 'dsja', 'xyzxyz'):
            saved = self.client.post('/save-subjects', headers=headers, json={'subjects': [{
                'name': invalid_text, 'difficulty': 'Medium', 'examDate': '2030-01-01',
                'topics': [{'name': 'Calculus'}],
            }]})
            self.assertEqual(saved.status_code, 400)
            quiz = self.client.post('/generate-quiz', headers=headers, json={
                'subjects': [invalid_text], 'sleepHours': 8,
            })
            self.assertEqual(quiz.status_code, 400)

        valid = self.client.post('/save-subjects', headers=headers, json={'subjects': [{
            'name': 'Physics', 'difficulty': 'Hard', 'examDate': '2030-01-01',
            'topics': [{'name': 'Thermodynamics'}],
        }]})
        self.assertEqual(valid.status_code, 200)

    def test_quiz_response_schema_is_strict(self):
        from backend.app import validate_quiz_payload
        valid = [{
            'question': f'Question {i}',
            'options': ['A', 'B', 'C', 'D'],
            'correctAnswer': 'A',
            'topic': 'Algebra',
        } for i in range(7)]
        self.assertIsNone(validate_quiz_payload(valid, ['Algebra']))
        invalid = [dict(valid[0], correctAnswer='Not an option')] + valid[1:]
        self.assertIsNotNone(validate_quiz_payload(invalid, ['Algebra']))

    def test_subject_payload_is_validated(self):
        self.client.post('/register', json={
            'name': 'Subject User', 'email': 'subject@example.com',
            'password': 'StrongPass1!', 'education_level': 'CSE',
        })
        response = self.client.post('/login', json={
            'email': 'subject@example.com', 'password': 'StrongPass1!',
        })
        headers = {'Authorization': f"Bearer {response.get_json()['token']}"}
        result = self.client.post('/save-subjects', headers=headers, json={
            'subjects': [{'name': '', 'difficulty': 'Unknown', 'topics': []}],
        })
        self.assertEqual(result.status_code, 400)

        # Future multi-year exam date should be accepted and retrieved
        save_future = self.client.post('/save-subjects', headers=headers, json={
            'subjects': [{'name': 'JEE Advanced', 'difficulty': 'Hard', 'examDate': '2028-06-15', 'topics': [{'name': 'Calculus'}]}],
        })
        self.assertEqual(save_future.status_code, 200)
        retrieved = self.client.get('/get-subjects/subject@example.com', headers=headers)
        self.assertEqual(retrieved.status_code, 200)
        self.assertEqual(retrieved.get_json()[0]['examDate'], '2028-06-15')

    def test_duplicate_subjects_and_topics_are_rejected(self):
        self.client.post('/register', json={
            'name': 'Duplicate User', 'email': 'duplicate@example.com',
            'password': 'StrongPass1!', 'education_level': 'CSE',
        })
        login = self.client.post('/login', json={
            'email': 'duplicate@example.com', 'password': 'StrongPass1!',
        })
        headers = {'Authorization': f"Bearer {login.get_json()['token']}"}
        duplicate_subjects = self.client.post('/save-subjects', headers=headers, json={'subjects': [
            {'name': 'Physics', 'difficulty': 'Medium', 'topics': []},
            {'name': ' physics ', 'difficulty': 'Hard', 'topics': []},
        ]})
        self.assertEqual(duplicate_subjects.status_code, 400)
        duplicate_topics = self.client.post('/save-subjects', headers=headers, json={'subjects': [
            {'name': 'Physics', 'difficulty': 'Medium', 'topics': [{'name': 'Motion'}, {'name': ' motion '}]},
        ]})
        self.assertEqual(duplicate_topics.status_code, 400)

    def test_profile_fields_are_validated_server_side(self):
        invalid_registration = self.client.post('/register', json={
            'name': '1', 'email': 'invalid-name@example.com',
            'password': 'StrongPass1!', 'education_level': 'CSE',
        })
        self.assertEqual(invalid_registration.status_code, 400)

        self.client.post('/register', json={
            'name': 'Profile User', 'email': 'profile@example.com',
            'password': 'StrongPass1!', 'education_level': 'CSE',
        })
        login = self.client.post('/login', json={
            'email': 'profile@example.com', 'password': 'StrongPass1!',
        })
        headers = {'Authorization': f"Bearer {login.get_json()['token']}"}
        invalid_update = self.client.post('/update-profile', headers=headers, json={
            'email': 'profile@example.com', 'name': '1', 'education_level': 'CSE',
        })
        self.assertEqual(invalid_update.status_code, 400)

    def test_password_change_requires_current_password_and_invalidates_old_tokens(self):
        self.client.post('/register', json={
            'name': 'Password User', 'email': 'password@example.com',
            'password': 'StrongPass1!', 'education_level': 'CSE',
        })
        login = self.client.post('/login', json={
            'email': 'password@example.com', 'password': 'StrongPass1!',
        })
        old_headers = {'Authorization': f"Bearer {login.get_json()['token']}"}
        payload = {
            'name': 'Password User', 'education_level': 'CSE',
            'password': 'UpdatedPass2!',
        }
        missing_current = self.client.post('/update-profile', headers=old_headers, json=payload)
        self.assertEqual(missing_current.status_code, 400)

        wrong_current = self.client.post('/update-profile', headers=old_headers, json={
            **payload, 'currentPassword': 'WrongPass1!',
        })
        self.assertEqual(wrong_current.status_code, 403)

        changed = self.client.post('/update-profile', headers=old_headers, json={
            **payload, 'currentPassword': 'StrongPass1!',
        })
        self.assertEqual(changed.status_code, 200)
        self.assertTrue(changed.get_json().get('token'))
        self.assertEqual(self.client.get('/me', headers=old_headers).status_code, 401)
        new_headers = {'Authorization': f"Bearer {changed.get_json()['token']}"}
        self.assertEqual(self.client.get('/me', headers=new_headers).status_code, 200)
        self.assertEqual(self.client.post('/login', json={
            'email': 'password@example.com', 'password': 'UpdatedPass2!',
        }).status_code, 200)

    def test_plan_and_review_payloads_are_validated(self):
        self.client.post('/register', json={
            'name': 'Validation User', 'email': 'validation@example.com',
            'password': 'StrongPass1!', 'education_level': 'CSE',
        })
        response = self.client.post('/login', json={
            'email': 'validation@example.com', 'password': 'StrongPass1!',
        })
        headers = {'Authorization': f"Bearer {response.get_json()['token']}"}
        bad_plan = self.client.post('/save-plan', headers=headers, json={'plan': {'not': 'a list'}})
        self.assertEqual(bad_plan.status_code, 400)
        bad_review = self.client.post('/save-review', headers=headers, json={
            'topic_name': '', 'next_review_date': 'not-a-date', 'interval': 0,
        })
        self.assertEqual(bad_review.status_code, 400)

    def test_reviews_are_returned_in_due_date_order(self):
        self.client.post('/register', json={
            'name': 'Review User', 'email': 'review@example.com',
            'password': 'StrongPass1!', 'education_level': 'CSE',
        })
        login = self.client.post('/login', json={
            'email': 'review@example.com', 'password': 'StrongPass1!',
        })
        headers = {'Authorization': f"Bearer {login.get_json()['token']}"}
        for topic, review_date in [('Zoology', '2030-03-04'), ('Algebra', '2030-03-03')]:
            saved = self.client.post('/save-review', headers=headers, json={
                'email': 'review@example.com', 'topic_name': topic,
                'next_review_date': review_date, 'interval': 3, 'ease_factor': 2.5,
            })
            self.assertEqual(saved.status_code, 200)

        reviews = self.client.get('/get-reviews/review@example.com', headers=headers)
        self.assertEqual(reviews.status_code, 200)
        self.assertEqual([review['topic_name'] for review in reviews.get_json()], ['Algebra', 'Zoology'])

    def test_me_returns_authenticated_user(self):
        self.client.post('/register', json={
            'name': 'Me User', 'email': 'me@example.com',
            'password': 'StrongPass1!', 'education_level': 'CSE',
        })
        response = self.client.post('/login', json={
            'email': 'me@example.com', 'password': 'StrongPass1!',
        })
        headers = {'Authorization': f"Bearer {response.get_json()['token']}"}
        me = self.client.get('/me', headers=headers)
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.get_json()['email'], 'me@example.com')

    def test_latest_plan_uses_id_tiebreaker(self):
        self.client.post('/register', json={
            'name': 'History User', 'email': 'history@example.com',
            'password': 'StrongPass1!', 'education_level': 'CSE',
        })
        response = self.client.post('/login', json={
            'email': 'history@example.com', 'password': 'StrongPass1!',
        })
        headers = {'Authorization': f"Bearer {response.get_json()['token']}"}
        self.client.post('/save-plan', headers=headers, json={'plan': [{'name': 'First', 'hours': 1, 'topics': []}]})
        self.client.post('/save-plan', headers=headers, json={'plan': [{'name': 'Second', 'hours': 1, 'topics': []}]})
        latest = self.client.get('/get-plan/history@example.com', headers=headers)
        self.assertEqual(latest.status_code, 200)
        self.assertEqual(latest.get_json()[0]['name'], 'Second')

    def test_rate_limiter_returns_retry_response(self):
        from backend.app import rate_limit, rate_limit_buckets
        rate_limit_buckets.clear()

        @rate_limit(1, 60)
        def limited():
            return 'ok'

        with planify.app.test_request_context('/limited'):
            self.assertEqual(limited(), 'ok')
        with planify.app.test_request_context('/limited'):
            response = limited()
            self.assertEqual(response.status_code, 429)
            self.assertTrue(response.headers.get('Retry-After'))

    def test_backend_planning_flow_and_task_lifecycle(self):
        # Keep this integration flow valid regardless of the calendar date.
        # The scheduler correctly does not plan work for already-passed exams.
        os_exam_date = (date.today() + timedelta(days=8)).isoformat()
        db_exam_date = (date.today() + timedelta(days=13)).isoformat()
        # 1. Register & login
        self.client.post('/register', json={
            'name': 'Planner User', 'email': 'planner@example.com',
            'password': 'StrongPass1!', 'education_level': 'B.Tech CSE',
        })
        login = self.client.post('/login', json={
            'email': 'planner@example.com', 'password': 'StrongPass1!',
        })
        headers = {'Authorization': f"Bearer {login.get_json()['token']}"}

        # 2. Save subjects
        self.client.post('/save-subjects', headers=headers, json={'subjects': [
            {'name': 'Operating Systems', 'difficulty': 'Hard', 'examDate': os_exam_date, 'topics': [{'name': 'Deadlocks'}, {'name': 'Semaphores'}]},
            {'name': 'Database Systems', 'difficulty': 'Medium', 'examDate': db_exam_date, 'topics': [{'name': 'Normalization'}]}
        ]})

        # 3. Generate Plan on backend
        gen_res = self.client.post('/generate-plan', headers=headers, json={'sleepHours': 8})
        self.assertEqual(gen_res.status_code, 200)
        data = gen_res.get_json()
        self.assertIn('schedule', data)
        self.assertGreater(data['totalTasks'], 0)
        first_task = data['schedule']['week'][0]['phases'][0]['tasks'][0]
        task_id = first_task['id']

        # 4. Toggle Task status (Complete)
        toggle_res = self.client.post('/toggle-task', headers=headers, json={'taskId': task_id, 'completed': True})
        self.assertEqual(toggle_res.status_code, 200)
        t_data = toggle_res.get_json()
        self.assertTrue(t_data['completed'])
        self.assertEqual(t_data['xp'], 10)

        # 5. Get active schedule with live completion
        active = self.client.get('/get-active-schedule/planner@example.com', headers=headers)
        self.assertEqual(active.status_code, 200)
        act_data = active.get_json()
        self.assertTrue(act_data['completedTasks'].get(task_id))
        self.assertEqual(act_data['sleepHours'], 8)
        persisted_task_ids = [
            task['id'] for day in act_data['schedule']['week']
            for phase in day['phases'] for task in phase['tasks']
        ]
        self.assertIn(task_id, persisted_task_ids)

        # 6. Skip task and verify rescheduling
        task_to_skip = next(
            task for day in data['schedule']['week'] for phase in day['phases']
            for task in phase['tasks'] if task['id'] != task_id and not task.get('isCritical')
        )
        skip_res = self.client.post('/skip-task', headers=headers, json={
            'taskId': task_to_skip['id'], 'sleepHours': 8
        })
        self.assertEqual(skip_res.status_code, 200)
        s_data = skip_res.get_json()
        self.assertGreaterEqual(len(s_data['skippedTasks']), 1)
        rescheduled = [
            task for day in s_data['schedule']['week'] for phase in day['phases']
            for task in phase['tasks'] if task['id'] == task_to_skip['id']
        ]
        self.assertEqual(len(rescheduled), 1)
        self.assertTrue(rescheduled[0]['isSkipped'])

        # 7. Reset only active work; keep historical plan records intact.
        reset = self.client.post('/reset-dashboard', headers=headers)
        self.assertEqual(reset.status_code, 200)
        cleared = self.client.get('/get-active-schedule/planner@example.com', headers=headers)
        self.assertEqual(cleared.status_code, 200)
        self.assertEqual(cleared.get_json()['schedule']['week'], [])
        self.assertEqual(self.client.get('/get-subjects/planner@example.com', headers=headers).get_json(), [])
        self.assertGreaterEqual(len(self.client.get('/get-history/planner@example.com', headers=headers).get_json()), 1)

    def test_resilient_academic_fallback_quiz(self):
        from backend.app import generate_academic_fallback_quiz
        questions = generate_academic_fallback_quiz(['Data Structures', 'Algorithms'], 'B.Tech')
        self.assertGreaterEqual(len(questions), 7)
        for q in questions:
            self.assertIn('question', q)
            self.assertEqual(len(q['options']), 4)
            self.assertIn(q['correctAnswer'], q['options'])
            self.assertIn(q['topic'], ['Data Structures', 'Algorithms'])


if __name__ == '__main__':
    unittest.main()
