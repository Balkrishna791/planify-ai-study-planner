import sqlite3
import json
import re
import warnings
import logging
import uuid
import time
import math
import os
from xml.sax.saxutils import escape as xml_escape
from collections import defaultdict, deque
from threading import Lock
from functools import wraps
warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", category=DeprecationWarning)

from flask import Flask, request, jsonify, g
from flask_cors import CORS
from flask_bcrypt import Bcrypt
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from werkzeug.exceptions import RequestEntityTooLarge
from werkzeug.utils import secure_filename
try:
    from dotenv import load_dotenv
except ImportError:
    def load_dotenv(path, *_args, **_kwargs):
        """Small safe fallback for a simple local KEY=value .env file."""
        if not path or not os.path.isfile(path):
            return False
        with open(path, 'r', encoding='utf-8') as env_file:
            for raw_line in env_file:
                line = raw_line.strip()
                if not line or line.startswith('#') or '=' not in line:
                    continue
                key, value = line.split('=', 1)
                key = key.strip()
                if key:
                    os.environ.setdefault(key, value.strip().strip('"').strip("'"))
        return True

import google.generativeai as genai

try:
    from backend import planner
except ImportError:
    import planner

try:
    from backend import syllabus_intelligence
except ImportError:
    import syllabus_intelligence

try:
    from backend.database import (
        DATABASE_ERRORS, DATABASE_INTEGRITY_ERRORS, DATABASE_OPERATIONAL_ERRORS, connect as connect_database,
    )
except ImportError:
    from database import (
        DATABASE_ERRORS, DATABASE_INTEGRITY_ERRORS, DATABASE_OPERATIONAL_ERRORS, connect as connect_database,
    )

# Load only the backend-local environment file. It is gitignored and never served to browsers.
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'))

app = Flask(__name__, static_folder='../frontend/build', static_url_path='/')
app.logger.setLevel(logging.INFO)
app.config['SECRET_KEY'] = os.environ.get('PLANIFY_SECRET_KEY', 'dev-only-change-me')
# Each upload is capped at 10 MB. A PYQ request can contain up to five files,
# so its whole multipart body has a separate 50 MB ceiling.
app.config['MAX_CONTENT_LENGTH'] = syllabus_intelligence.MAX_REQUEST_BYTES
if app.config['SECRET_KEY'] == 'dev-only-change-me':
    warnings.warn('PLANIFY_SECRET_KEY is not configured; use a strong secret in production.')
allowed_origins = [o.strip() for o in os.environ.get('PLANIFY_CORS_ORIGINS', 'http://localhost:3000').split(',') if o.strip()]
CORS(app, resources={r"/*": {"origins": allowed_origins}})
bcrypt = Bcrypt(app)
token_serializer = URLSafeTimedSerializer(app.config['SECRET_KEY'], salt='planify-auth')
rate_limit_buckets = defaultdict(deque)
rate_limit_lock = Lock()

@app.before_request
def assign_request_id():
    g.request_id = request.headers.get('X-Request-ID') or str(uuid.uuid4())

@app.after_request
def add_request_id(response):
    response.headers['X-Request-ID'] = getattr(g, 'request_id', str(uuid.uuid4()))
    return response

@app.after_request
def log_request(response):
    app.logger.info('%s %s -> %s [%s]', request.method, request.path, response.status_code, g.request_id)
    return response

@app.after_request
def add_security_headers(response):
    response.headers.setdefault('X-Content-Type-Options', 'nosniff')
    response.headers.setdefault('X-Frame-Options', 'DENY')
    response.headers.setdefault('Referrer-Policy', 'strict-origin-when-cross-origin')
    response.headers.setdefault('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    if request.path.startswith('/api/') or request.path in ('/login', '/register') or request.method != 'GET':
        response.headers.setdefault('Cache-Control', 'no-store')
    return response


@app.errorhandler(RequestEntityTooLarge)
def uploaded_request_too_large(_error):
    return jsonify({
        'error': f'Upload request is too large. Upload up to {syllabus_intelligence.MAX_PYQ_FILES} files, each {syllabus_intelligence.MAX_UPLOAD_BYTES // (1024 * 1024)} MB or smaller.'
    }), 413

GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY')
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

DB_PATH = os.environ.get('PLANIFY_DB_PATH', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'database.db'))

def issue_token(student):
    return token_serializer.dumps({
        'student_id': student['student_id'], 'email': student['email'],
        'auth_version': int(student['auth_version'] or 0),
    })

def bounded_number(value, name, minimum=0, maximum=None):
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValueError(f'{name} must be a number')
    if number < minimum or (maximum is not None and number > maximum):
        raise ValueError(f'{name} is outside the allowed range')
    return number


def validate_sleep_hours(value):
    """Return a supplied sleep-hours value; never substitute a default."""
    if value is None or isinstance(value, bool) or (isinstance(value, str) and not value.strip()):
        raise ValueError('sleepHours is required')
    try:
        sleep_hours = float(value)
    except (TypeError, ValueError):
        raise ValueError('sleepHours must be a number')
    if not math.isfinite(sleep_hours) or not 0 < sleep_hours < 24:
        raise ValueError('sleepHours must be greater than 0 and less than 24')
    return sleep_hours


KNOWN_ACADEMIC_ABBREVIATIONS = {
    'ai', 'api', 'ar', 'aws', 'c', 'c#', 'c++', 'cad', 'cam', 'cd', 'ci', 'cn',
    'cpu', 'crud', 'css', 'dbms', 'dl', 'dns', 'dsa', 'emi', 'emc', 'erp', 'ftp',
    'gcp', 'gpu', 'hci', 'hdd', 'html', 'http', 'iot', 'ip', 'it', 'java', 'js',
    'json', 'jwt', 'lan', 'ml', 'mvc', 'mvp', 'mvvm', 'nlp', 'nosql', 'oop', 'os',
    'pcb', 'php', 'plc', 'ram', 'rest', 'rom', 'r', 'sdk', 'se', 'seo', 'sql',
    'ssh', 'ssd', 'tcp', 'ts', 'ui', 'ux', 'vlsi', 'vpn', 'vr', 'wan', 'xml', 'yaml',
}


def academic_text_error(value, label='Academic term'):
    """Reject obvious keyboard-smash input without restricting real curricula."""
    if not isinstance(value, str):
        return f'{label} must be text'
    text = ' '.join(value.split())
    if not 2 <= len(text) <= 300:
        return f'{label} must contain 2 to 300 characters'

    normalized = text.casefold()
    if normalized in KNOWN_ACADEMIC_ABBREVIATIONS:
        return None
    letters = ''.join(char for char in normalized if char.isalpha())
    if len(letters) < 2:
        return f'{label} must contain letters'
    if len(set(letters)) == 1 or re.fullmatch(r'(.{1,3})\1+', letters):
        return f'{label} appears to be repeated or meaningless text'

    # Preserve non-English curricula. The following checks apply only to ASCII-like input.
    ascii_letters = ''.join(char for char in letters if 'a' <= char <= 'z')
    if ascii_letters and len(ascii_letters) == len(letters):
        if re.search(r'(qwer|asdf|zxcv|hjkl)', ascii_letters):
            return f'{label} appears to be keyboard-smash text'
        vowel_count = sum(char in 'aeiou' for char in ascii_letters)
        if len(ascii_letters) >= 4 and vowel_count == 0:
            return f'{label} appears to be meaningless text'
        if 4 <= len(ascii_letters) <= 6 and vowel_count == 1 and re.match(r'^[bcdfghjklmnpqrstvwxyz]{3}', ascii_letters):
            return f'{label} appears to be meaningless text'
    return None


def academic_items_error(subjects):
    """Validate subject/topic names independently of optional AI validation."""
    if not isinstance(subjects, list):
        return 'subjects must be an array'
    for subject in subjects:
        if not isinstance(subject, dict):
            return 'each subject must be an object'
        error = academic_text_error(subject.get('name', ''), 'Subject name')
        if error:
            return error
        topics = subject.get('topics', [])
        if not isinstance(topics, list):
            return 'topics must be an array'
        for topic in topics:
            topic_name = topic.get('name', '') if isinstance(topic, dict) else topic
            error = academic_text_error(topic_name, 'Topic name')
            if error:
                return error
    return None

def rate_limit(limit, window_seconds):
    def decorator(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            client = request.headers.get('X-Forwarded-For', request.remote_addr or 'unknown').split(',')[0].strip()
            bucket_key = (view.__name__, client)
            now = time.monotonic()
            with rate_limit_lock:
                bucket = rate_limit_buckets[bucket_key]
                while bucket and now - bucket[0] >= window_seconds:
                    bucket.popleft()
                if len(bucket) >= limit:
                    retry_after = max(1, int(window_seconds - (now - bucket[0])))
                    response = jsonify({'error': 'Too many requests. Please try again later.'})
                    response.status_code = 429
                    response.headers['Retry-After'] = str(retry_after)
                    return response
                bucket.append(now)
            return view(*args, **kwargs)
        return wrapped
    return decorator

def validate_subjects_payload(subjects):
    if not isinstance(subjects, list) or len(subjects) > 100:
        return 'subjects must be an array of at most 100 items'
    seen_subjects = set()
    for subject in subjects:
        if not isinstance(subject, dict):
            return 'each subject must be an object'
        name = str(subject.get('name', '')).strip()
        if not 1 <= len(name) <= 200:
            return 'subject names must contain 1 to 200 characters'
        normalized_name = name.casefold()
        if normalized_name in seen_subjects:
            return 'duplicate subject names are not allowed'
        seen_subjects.add(normalized_name)
        difficulty = subject.get('difficulty', '')
        if difficulty not in ('Easy', 'Medium', 'Hard'):
            return 'difficulty must be Easy, Medium, or Hard'
        exam_date = subject.get('examDate', '')
        if exam_date:
            try:
                from datetime import date
                date.fromisoformat(exam_date)
            except (TypeError, ValueError):
                return 'examDate must use YYYY-MM-DD format'
        topics = subject.get('topics', [])
        if not isinstance(topics, list) or len(topics) > 100:
            return 'topics must be an array of at most 100 items'
        seen_topics = set()
        for topic in topics:
            if not isinstance(topic, dict) or not 1 <= len(str(topic.get('name', '')).strip()) <= 300:
                return 'topic names must contain 1 to 300 characters'
            normalized_topic = str(topic.get('name', '')).strip().casefold()
            if normalized_topic in seen_topics:
                return 'duplicate topic names are not allowed within a subject'
            seen_topics.add(normalized_topic)
    return academic_items_error(subjects)

def validate_plan_payload(plan):
    if not isinstance(plan, list) or len(plan) > 100:
        return 'plan must be an array of at most 100 subjects'
    for item in plan:
        if not isinstance(item, dict) or not 1 <= len(str(item.get('name', '')).strip()) <= 200:
            return 'each plan item must have a name of 1 to 200 characters'
        try:
            hours = float(item.get('hours', 0))
        except (TypeError, ValueError):
            return 'plan hours must be numeric'
        if hours < 0 or hours > 24:
            return 'plan hours must be between 0 and 24'
        topics = item.get('topics', [])
        if not isinstance(topics, list) or len(topics) > 100:
            return 'plan topics must be an array of at most 100 items'
    return None

def validate_quiz_payload(quiz, topics):
    if not isinstance(quiz, list) or not 7 <= len(quiz) <= 10:
        return 'AI returned an invalid number of questions'
    allowed_topics = set(topics)
    for question in quiz:
        if not isinstance(question, dict):
            return 'AI returned an invalid question object'
        text = question.get('question')
        options = question.get('options')
        answer = question.get('correctAnswer')
        topic = question.get('topic')
        if not isinstance(text, str) or not text.strip() or not isinstance(options, list) or len(options) != 4:
            return 'AI returned an invalid question or options list'
        if any(not isinstance(option, str) or not option.strip() for option in options):
            return 'AI returned an invalid option'
        if not isinstance(answer, str) or answer not in options:
            return 'AI returned an invalid correct answer'
        if not isinstance(topic, str) or topic.strip() not in allowed_topics:
            return 'AI returned a question outside the supplied topics'
    return None

def validate_profile_fields(name, education_level):
    if not isinstance(name, str) or not 2 <= len(name.strip()) <= 100 or not re.search(r'[A-Za-z].*[A-Za-z]|[A-Za-z]{2}', name):
        return 'Name must contain 2 to 100 characters and at least two letters'
    if not isinstance(education_level, str) or len(education_level.strip()) > 150:
        return 'Education level must contain at most 150 characters'
    return None

def generate_academic_fallback_quiz(subjects, education_level="General"):
    questions = []
    templates = [
        ("What is the primary conceptual focus of {topic}?", 
         ["Theoretical principles and fundamental laws", "Random numerical estimations", "Superficial memorization", "Unrelated practical anecdotes"],
         "Theoretical principles and fundamental laws",
         "The fundamental study of {topic} focuses on underlying principles and conceptual laws."),
        ("In problem solving related to {topic}, which methodology is most effective?",
         ["Step-by-step analytical derivation and practice", "Guessing without validation", "Ignoring baseline constraints", "Skipping fundamental definitions"],
         "Step-by-step analytical derivation and practice",
         "Analytical derivation ensures logical consistency and conceptual mastery in {topic}."),
        ("Which of the following best describes the core utility of studying {topic}?",
         ["Building structured knowledge and domain problem-solving", "Temporary exam memorization only", "Replacing all other scientific domains", "Avoiding revision"],
         "Building structured knowledge and domain problem-solving",
         "{topic} develops structured analytical frameworks that apply to broader domain problem solving."),
        ("When reviewing key topics in {topic}, why is active recall emphasized?",
         ["It strengthens neural pathways and long-term memory retention", "It reduces the need to understand fundamentals", "It only works for easy subjects", "It eliminates the need for practice"],
         "It strengthens neural pathways and long-term memory retention",
         "Active recall forces the brain to retrieve information, solidifying memory consolidation in {topic}."),
    ]
    
    q_count = 0
    while len(questions) < 7:
        for topic in subjects:
            if len(questions) >= 10:
                break
            tmpl = templates[q_count % len(templates)]
            q_text = tmpl[0].format(topic=topic)
            opts = list(tmpl[1])
            ans = tmpl[2]
            exp = tmpl[3].format(topic=topic)
            questions.append({
                "question": q_text,
                "options": opts,
                "correctAnswer": ans,
                "topic": topic,
                "explanation": exp
            })
            q_count += 1
    return questions[:max(7, min(10, len(questions)))]

def auth_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        header = request.headers.get('Authorization', '')
        if not header.startswith('Bearer '):
            return jsonify({'error': 'Authentication required'}), 401
        try:
            claims = token_serializer.loads(header[7:].strip(), max_age=60 * 60 * 24 * 7)
        except (BadSignature, SignatureExpired):
            return jsonify({'error': 'Invalid or expired token'}), 401
        student_id = claims.get('student_id')
        claimed_email = claims.get('email', '').lower()
        try:
            token_version = int(claims.get('auth_version', 0))
        except (TypeError, ValueError):
            return jsonify({'error': 'Invalid or expired token'}), 401
        if not isinstance(student_id, int) or not claimed_email:
            return jsonify({'error': 'Invalid or expired token'}), 401
        conn = get_db()
        try:
            student = conn.execute(
                'SELECT email, auth_version FROM students WHERE student_id=?', (student_id,)
            ).fetchone()
        finally:
            conn.close()
        if not student or student['email'].lower() != claimed_email or int(student['auth_version'] or 0) != token_version:
            return jsonify({'error': 'Your session is no longer valid. Please sign in again.'}), 401
        g.student_id = student_id
        g.user_email = claimed_email
        supplied_email = kwargs.get('email')
        if supplied_email is None and request.is_json:
            supplied_email = (request.get_json(silent=True) or {}).get('email')
        if supplied_email and supplied_email.strip().lower() != g.user_email:
            return jsonify({'error': 'You cannot access another user data'}), 403
        return view(*args, **kwargs)
    return wrapped


@app.route('/health', methods=['GET'])
def health_check():
    """Public deployment probe; never exposes secrets, users, or AI status."""
    conn = None
    try:
        conn = get_db()
        conn.execute('SELECT 1').fetchone()
    except DATABASE_ERRORS:
        response = jsonify({'status': 'unavailable', 'service': 'planify-api'})
        response.status_code = 503
        response.headers['Cache-Control'] = 'no-store'
        return response
    finally:
        if conn is not None:
            conn.close()
    response = jsonify({'status': 'ok', 'service': 'planify-api', 'database': 'ok'})
    response.headers['Cache-Control'] = 'no-store'
    return response


def public_base_url():
    """Use the configured canonical site URL; fall back to the current host locally."""
    configured_url = os.environ.get('PLANIFY_PUBLIC_URL', '').strip().rstrip('/')
    if configured_url.startswith(('https://', 'http://')):
        return configured_url
    return request.url_root.rstrip('/')


@app.get('/robots.txt')
def robots_txt():
    base_url = public_base_url()
    response = app.response_class(
        f'User-agent: *\nAllow: /\nSitemap: {base_url}/sitemap.xml\n',
        mimetype='text/plain',
    )
    response.headers['Cache-Control'] = 'public, max-age=3600'
    return response


@app.get('/sitemap.xml')
def sitemap_xml():
    base_url = xml_escape(public_base_url())
    content = f'''<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>{base_url}/</loc></url>
</urlset>
'''
    response = app.response_class(content, mimetype='application/xml')
    response.headers['Cache-Control'] = 'public, max-age=3600'
    return response


@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve(path):
    if path != "" and os.path.exists(app.static_folder + '/' + path):
        return app.send_static_file(path)
    elif os.path.exists(os.path.join(app.static_folder, 'index.html')):
        return app.send_static_file('index.html')
    return jsonify({'error': 'Frontend build is not installed'}), 404

def get_db():
    return connect_database(DB_PATH)


def load_active_schedule(conn, student_id):
    """Build the active schedule from persisted tasks, preserving task IDs and durations."""
    plan = conn.execute("""
        SELECT plan_id, sleep_hours FROM study_plans
        WHERE student_id=? ORDER BY plan_id DESC LIMIT 1
    """, (student_id,)).fetchone()
    if not plan:
        return {"week": [], "total_tasks": 0, "total_mins": 0}, None, {}

    rows = conn.execute("""
        SELECT task_ref_id, task_name, subject_name, phase_index, task_date,
               duration_mins, difficulty, is_critical, is_rescheduled, status
        FROM tasks WHERE student_id=? AND plan_id=?
        ORDER BY task_date ASC, phase_index ASC, task_id ASC
    """, (student_id, plan['plan_id'])).fetchall()
    if not rows:
        return {"week": [], "total_tasks": 0, "total_mins": 0}, plan['sleep_hours'], {}

    phase_limits = planner.calculate_phase_limits(plan['sleep_hours'])
    by_date, completed = {}, {}
    for row in rows:
        task_date = row['task_date']
        if task_date not in by_date:
            try:
                day_name = __import__('datetime').date.fromisoformat(task_date).strftime('%a')
            except (TypeError, ValueError):
                day_name = task_date
            by_date[task_date] = {
                'day': day_name, 'date': task_date, 'totalLimit': sum(phase_limits),
                'usedHours': 0, 'phases': [{'limit': limit, 'tasks': []} for limit in phase_limits],
            }
        phase_index = row['phase_index']
        if not isinstance(phase_index, int) or not 0 <= phase_index < 4:
            continue
        by_date[task_date]['phases'][phase_index]['tasks'].append({
            'id': row['task_ref_id'], 'name': row['task_name'], 'subjectName': row['subject_name'],
            'durationMins': row['duration_mins'], 'difficulty': row['difficulty'],
            'isCritical': bool(row['is_critical']), 'isSkipped': bool(row['is_rescheduled']),
            'originalPhase': phase_index,
        })
        by_date[task_date]['usedHours'] += row['duration_mins'] or 0
        if row['status'] == 'Completed':
            completed[row['task_ref_id']] = True

    week = [by_date[key] for key in sorted(by_date)]
    return {
        'week': week,
        'total_tasks': len(rows),
        'total_mins': sum((row['duration_mins'] or 0) for row in rows),
    }, plan['sleep_hours'], completed

def create_tables():
    conn = get_db()
    
    conn.execute("""
    CREATE TABLE IF NOT EXISTS students (
        student_id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        education_level TEXT DEFAULT '',
        auth_version INTEGER NOT NULL DEFAULT 0
    )
    """)

    try:
        conn.execute("ALTER TABLE students ADD COLUMN education_level TEXT DEFAULT ''")
        conn.commit()
    except DATABASE_OPERATIONAL_ERRORS:
        pass

    try:
        conn.execute("ALTER TABLE students ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0")
        conn.commit()
    except DATABASE_OPERATIONAL_ERRORS:
        pass

    conn.execute("""
    CREATE TABLE IF NOT EXISTS subjects (
        subject_id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER,
        subject_name TEXT NOT NULL,
        difficulty TEXT,
        exam_date TEXT,
        FOREIGN KEY(student_id) REFERENCES students(student_id)
    )
    """)

    conn.execute("""
    CREATE TABLE IF NOT EXISTS topics (
        topic_id INTEGER PRIMARY KEY AUTOINCREMENT,
        subject_id INTEGER,
        topic_name TEXT,
        status TEXT DEFAULT 'Pending',
        FOREIGN KEY(subject_id) REFERENCES subjects(subject_id)
    )
    """)

    conn.execute("""
    CREATE TABLE IF NOT EXISTS study_plans (
        plan_id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER,
        generated_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        total_days INTEGER DEFAULT 7,
        sleep_hours REAL DEFAULT 8,
        start_date TEXT,
        total_tasks INTEGER DEFAULT 0,
        total_mins INTEGER DEFAULT 0,
        FOREIGN KEY(student_id) REFERENCES students(student_id)
    )
    """)

    for col_def in [
        "sleep_hours REAL DEFAULT 8",
        "start_date TEXT",
        "total_tasks INTEGER DEFAULT 0",
        "total_mins INTEGER DEFAULT 0",
    ]:
        try:
            conn.execute(f"ALTER TABLE study_plans ADD COLUMN {col_def}")
            conn.commit()
        except DATABASE_OPERATIONAL_ERRORS:
            pass

    conn.execute("""
    CREATE TABLE IF NOT EXISTS tasks (
        task_id INTEGER PRIMARY KEY AUTOINCREMENT,
        plan_id INTEGER,
        student_id INTEGER,
        task_ref_id TEXT,
        task_name TEXT NOT NULL DEFAULT '',
        subject_name TEXT DEFAULT '',
        phase_index INTEGER DEFAULT 0,
        task_date TEXT,
        duration_mins INTEGER DEFAULT 45,
        difficulty TEXT DEFAULT 'Medium',
        is_critical INTEGER DEFAULT 0,
        is_rescheduled INTEGER DEFAULT 0,
        status TEXT DEFAULT 'Pending',
        study_hours REAL,
        phase TEXT,
        FOREIGN KEY(plan_id) REFERENCES study_plans(plan_id),
        FOREIGN KEY(student_id) REFERENCES students(student_id)
    )
    """)

    for col_def in [
        "task_ref_id TEXT",
        "student_id INTEGER",
        "task_name TEXT DEFAULT ''",
        "subject_name TEXT DEFAULT ''",
        "phase_index INTEGER DEFAULT 0",
        "duration_mins INTEGER DEFAULT 45",
        "difficulty TEXT DEFAULT 'Medium'",
        "is_critical INTEGER DEFAULT 0",
        "is_rescheduled INTEGER DEFAULT 0",
    ]:
        try:
            conn.execute(f"ALTER TABLE tasks ADD COLUMN {col_def}")
            conn.commit()
        except DATABASE_OPERATIONAL_ERRORS:
            pass

    conn.execute("""
    CREATE TABLE IF NOT EXISTS history (
        history_id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER,
        data TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(student_id) REFERENCES students(student_id)
    )
    """)

    conn.execute("""
    CREATE TABLE IF NOT EXISTS progress (
        progress_id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER,
        completed_hours REAL DEFAULT 0,
        total_hours REAL DEFAULT 0,
        percentage REAL DEFAULT 0,
        FOREIGN KEY(student_id) REFERENCES students(student_id)
    )
    """)

    conn.execute("""
    CREATE TABLE IF NOT EXISTS task_progress (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER,
        completed_tasks TEXT DEFAULT '{}',
        skipped_tasks TEXT DEFAULT '[]',
        total_tasks INTEGER DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(student_id) REFERENCES students(student_id)
    )
    """)

    conn.execute("""
    CREATE TABLE IF NOT EXISTS daily_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER,
        stat_date TEXT NOT NULL,
        hours_studied REAL DEFAULT 0,
        tasks_completed INTEGER DEFAULT 0,
        FOREIGN KEY(student_id) REFERENCES students(student_id),
        UNIQUE(student_id, stat_date)
    )
    """)

    conn.execute("""
    CREATE TABLE IF NOT EXISTS review_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER,
        topic_name TEXT NOT NULL,
        next_review_date TEXT NOT NULL,
        interval INTEGER DEFAULT 1,
        ease_factor REAL DEFAULT 2.5,
        FOREIGN KEY(student_id) REFERENCES students(student_id),
        UNIQUE(student_id, topic_name)
    )
    """)

    conn.execute("""
    CREATE TABLE IF NOT EXISTS user_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER UNIQUE,
        xp INTEGER DEFAULT 0,
        level INTEGER DEFAULT 1,
        badges TEXT DEFAULT '[]',
        FOREIGN KEY(student_id) REFERENCES students(student_id)
    )
    """)

    # Syllabus Intelligence persists only reviewed structured data and paper
    # metadata. Uploaded files are analysed in memory and are never public.
    conn.execute("""
    CREATE TABLE IF NOT EXISTS syllabus_documents (
        syllabus_id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL,
        original_filename TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        source_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending_review',
        extracted_json TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        confirmed_at TIMESTAMP,
        FOREIGN KEY(student_id) REFERENCES students(student_id)
    )
    """)

    conn.execute("""
    CREATE TABLE IF NOT EXISTS syllabus_topic_map (
        syllabus_topic_id INTEGER PRIMARY KEY AUTOINCREMENT,
        syllabus_id INTEGER NOT NULL,
        student_id INTEGER NOT NULL,
        subject_name TEXT NOT NULL,
        unit_name TEXT NOT NULL,
        chapter_name TEXT NOT NULL,
        topic_name TEXT NOT NULL,
        FOREIGN KEY(syllabus_id) REFERENCES syllabus_documents(syllabus_id),
        FOREIGN KEY(student_id) REFERENCES students(student_id),
        UNIQUE(syllabus_id, subject_name, unit_name, chapter_name, topic_name)
    )
    """)

    conn.execute("""
    CREATE TABLE IF NOT EXISTS pyq_documents (
        pyq_id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL,
        syllabus_id INTEGER NOT NULL,
        original_filename TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        source_type TEXT NOT NULL,
        paper_label TEXT DEFAULT '',
        analysis_json TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(student_id) REFERENCES students(student_id),
        FOREIGN KEY(syllabus_id) REFERENCES syllabus_documents(syllabus_id)
    )
    """)

    conn.execute("""
    CREATE TABLE IF NOT EXISTS topic_priority_signals (
        signal_id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL,
        syllabus_topic_id INTEGER NOT NULL,
        pyq_frequency INTEGER NOT NULL DEFAULT 0,
        importance TEXT NOT NULL DEFAULT 'low',
        priority_signal REAL NOT NULL DEFAULT 0,
        evidence_json TEXT NOT NULL DEFAULT '[]',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(student_id) REFERENCES students(student_id),
        FOREIGN KEY(syllabus_topic_id) REFERENCES syllabus_topic_map(syllabus_topic_id),
        UNIQUE(student_id, syllabus_topic_id)
    )
    """)

    conn.executescript("""
    CREATE INDEX IF NOT EXISTS idx_students_email ON students(email);
    CREATE INDEX IF NOT EXISTS idx_subjects_student ON subjects(student_id);
    CREATE INDEX IF NOT EXISTS idx_topics_subject ON topics(subject_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_plan ON tasks(plan_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_date ON tasks(task_date);
    CREATE INDEX IF NOT EXISTS idx_history_student_created ON history(student_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_daily_stats_student_date ON daily_stats(student_id, stat_date DESC);
    CREATE INDEX IF NOT EXISTS idx_review_queue_student_date ON review_queue(student_id, next_review_date);
    CREATE INDEX IF NOT EXISTS idx_syllabus_documents_student_status ON syllabus_documents(student_id, status, syllabus_id DESC);
    CREATE INDEX IF NOT EXISTS idx_syllabus_topics_student_subject ON syllabus_topic_map(student_id, subject_name);
    CREATE INDEX IF NOT EXISTS idx_pyq_documents_student_syllabus ON pyq_documents(student_id, syllabus_id);
    CREATE INDEX IF NOT EXISTS idx_topic_priority_student ON topic_priority_signals(student_id, priority_signal DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_progress_student ON progress(student_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_task_progress_student ON task_progress(student_id);
    """)

    conn.commit()
    conn.close()

@app.get('/me')
@auth_required
def current_user():
    conn = get_db()
    user = conn.execute('SELECT name, email, education_level FROM students WHERE student_id=?', (g.student_id,)).fetchone()
    conn.close()
    if not user:
        return jsonify({'error': 'User not found'}), 404
    return jsonify(dict(user)), 200


def export_rows(conn, query, params=()):
    """Return JSON-safe dictionaries for a student's data export."""
    return [dict(row) for row in conn.execute(query, params).fetchall()]


@app.get('/account/export')
@auth_required
def export_account_data():
    """Let a signed-in student download stored Planify data, never credentials."""
    conn = get_db()
    try:
        profile = conn.execute(
            'SELECT name, email, education_level FROM students WHERE student_id=?', (g.student_id,)
        ).fetchone()
        if not profile:
            return jsonify({'error': 'User not found'}), 404

        subject_rows = export_rows(conn, '''
            SELECT subject_id, subject_name, difficulty, exam_date
            FROM subjects WHERE student_id=? ORDER BY subject_id
        ''', (g.student_id,))
        for subject in subject_rows:
            subject['topics'] = export_rows(conn, '''
                SELECT topic_name, status FROM topics WHERE subject_id=? ORDER BY topic_id
            ''', (subject.pop('subject_id'),))

        export_data = {
            'exportVersion': 1,
            'exportedAt': int(time.time()),
            'profile': dict(profile),
            'subjects': subject_rows,
            'studyPlans': export_rows(conn, '''
                SELECT plan_id, generated_date, total_days, sleep_hours, start_date, total_tasks, total_mins
                FROM study_plans WHERE student_id=? ORDER BY plan_id
            ''', (g.student_id,)),
            'tasks': export_rows(conn, '''
                SELECT task_ref_id, task_name, subject_name, phase_index, task_date, duration_mins,
                       difficulty, is_critical, is_rescheduled, status
                FROM tasks WHERE student_id=? ORDER BY task_id
            ''', (g.student_id,)),
            'progress': export_rows(conn, '''
                SELECT completed_hours, total_hours, percentage FROM progress WHERE student_id=?
            ''', (g.student_id,)),
            'taskProgress': export_rows(conn, '''
                SELECT completed_tasks, skipped_tasks, total_tasks, updated_at
                FROM task_progress WHERE student_id=?
            ''', (g.student_id,)),
            'dailyStats': export_rows(conn, '''
                SELECT stat_date, hours_studied, tasks_completed FROM daily_stats
                WHERE student_id=? ORDER BY stat_date
            ''', (g.student_id,)),
            'reviewQueue': export_rows(conn, '''
                SELECT topic_name, next_review_date, interval, ease_factor FROM review_queue
                WHERE student_id=? ORDER BY next_review_date
            ''', (g.student_id,)),
            'userStats': export_rows(conn, '''
                SELECT xp, level, badges FROM user_stats WHERE student_id=?
            ''', (g.student_id,)),
            'syllabusDocuments': export_rows(conn, '''
                SELECT original_filename, content_hash, source_type, status, extracted_json, created_at, confirmed_at
                FROM syllabus_documents WHERE student_id=? ORDER BY syllabus_id
            ''', (g.student_id,)),
            'syllabusTopics': export_rows(conn, '''
                SELECT subject_name, unit_name, chapter_name, topic_name
                FROM syllabus_topic_map WHERE student_id=? ORDER BY syllabus_topic_id
            ''', (g.student_id,)),
            'pyqDocuments': export_rows(conn, '''
                SELECT original_filename, content_hash, source_type, paper_label, analysis_json, created_at
                FROM pyq_documents WHERE student_id=? ORDER BY pyq_id
            ''', (g.student_id,)),
            'topicPrioritySignals': export_rows(conn, '''
                SELECT pyq_frequency, importance, priority_signal, evidence_json, updated_at
                FROM topic_priority_signals WHERE student_id=? ORDER BY signal_id
            ''', (g.student_id,)),
            'history': export_rows(conn, '''
                SELECT data, created_at FROM history WHERE student_id=? ORDER BY history_id
            ''', (g.student_id,)),
        }
    finally:
        conn.close()

    response = jsonify(export_data)
    response.headers['Cache-Control'] = 'no-store'
    response.headers['Content-Disposition'] = 'attachment; filename="planify-account-data.json"'
    return response


@app.delete('/account')
@auth_required
def delete_account():
    """Permanently delete the authenticated account after password confirmation."""
    data = request.get_json(silent=True) or {}
    confirmation = data.get('confirmation')
    current_password = data.get('currentPassword')
    if confirmation != 'DELETE':
        return jsonify({'error': 'Type DELETE to confirm permanent account removal.'}), 400
    if not isinstance(current_password, str) or not current_password:
        return jsonify({'error': 'Enter your current password to delete your account.'}), 400

    conn = get_db()
    try:
        student = conn.execute('SELECT password FROM students WHERE student_id=?', (g.student_id,)).fetchone()
        if not student or not bcrypt.check_password_hash(student['password'], current_password):
            return jsonify({'error': 'Current password is incorrect.'}), 403

        # Delete children explicitly: older local databases do not declare ON DELETE CASCADE.
        for table in (
            'topic_priority_signals', 'pyq_documents', 'syllabus_topic_map', 'syllabus_documents',
            'tasks', 'history', 'progress', 'task_progress', 'daily_stats', 'review_queue', 'user_stats',
        ):
            conn.execute(f'DELETE FROM {table} WHERE student_id=?', (g.student_id,))
        conn.execute('DELETE FROM topics WHERE subject_id IN (SELECT subject_id FROM subjects WHERE student_id=?)', (g.student_id,))
        conn.execute('DELETE FROM subjects WHERE student_id=?', (g.student_id,))
        conn.execute('DELETE FROM study_plans WHERE student_id=?', (g.student_id,))
        conn.execute('DELETE FROM students WHERE student_id=?', (g.student_id,))
        conn.commit()
    except Exception:
        conn.rollback()
        app.logger.exception('Account deletion failed')
        return jsonify({'error': 'Account could not be deleted. Please try again.'}), 500
    finally:
        conn.close()

    return jsonify({'message': 'Account deleted permanently.'}), 200


@app.route("/register", methods=["POST"])
@rate_limit(20, 60 * 60)
def register():
    data = request.get_json(silent=True) or {}
    name = data.get("name", "").strip()
    email = data.get("email", "").strip().lower()
    raw_password = data.get("password", "")
    education_level = data.get("education_level", "").strip()

    if not name or not email or not raw_password:
        return jsonify({"error": "All fields are required"}), 400
    profile_error = validate_profile_fields(name, education_level)
    if profile_error:
        return jsonify({'error': profile_error}), 400

    if not re.match(r'^[a-zA-Z0-9\.-]*[a-zA-Z][a-zA-Z0-9\.-]*@[\w\.-]+\.\w+$', email):
        return jsonify({"error": "Email address must contain at least one letter before @ (e.g., name123@gmail.com)"}), 400

    password_pattern = r'^(?=.*\d)(?=.*[A-Z])(?=.*[a-z])(?=.*[@#$%^&+=!_]).{8,128}$'
    if not re.match(password_pattern, raw_password):
        return jsonify({"error": "Password must be 8-128 characters long, include a number, uppercase, lowercase, and special character."}), 400

    password = bcrypt.generate_password_hash(raw_password).decode("utf-8")

    try:
        conn = get_db()
        conn.execute("INSERT INTO students (name, email, password, education_level) VALUES (?, ?, ?, ?)", (name, email, password, education_level))
        conn.commit()
        conn.close()
        return jsonify({"message": "Success"}), 201
    except DATABASE_INTEGRITY_ERRORS:
        if 'conn' in locals():
            conn.rollback()
            conn.close()
        return jsonify({"error": "Email already registered. Please login."}), 400
    except Exception as e:
        print(f"REGISTER ERROR: {e}")
        if 'conn' in locals():
            conn.rollback()
            conn.close()
        return jsonify({"error": "Server error during registration"}), 500

@app.route("/login", methods=["POST"])
@rate_limit(30, 60)
def login():
    data = request.get_json(silent=True) or {}
    email = data.get("email", "").strip().lower()
    password = data.get("password", "")
    conn = get_db()
    user = conn.execute("SELECT * FROM students WHERE lower(email)=?", (email,)).fetchone()
    conn.close()
    if user and bcrypt.check_password_hash(user["password"], password):
        return jsonify({
            "name": user["name"],
            "email": user["email"],
            "education_level": user["education_level"],
            "token": issue_token(user)
        }), 200
    return jsonify({"error": "Invalid email or password"}), 401

@app.route("/update-profile", methods=["POST"])
@auth_required
def update_profile():
    data = request.get_json(silent=True) or {}
    # The authenticated identity is authoritative; never select a profile
    # based on a client-controlled email field.
    email = g.user_email
    name = data.get("name", "").strip()
    education_level = data.get("education_level", "").strip()
    raw_password = data.get("password", "")
    current_password = data.get("currentPassword", "")
    profile_error = validate_profile_fields(name, education_level)
    if profile_error:
        return jsonify({'error': profile_error}), 400
    
    conn = get_db()
    try:
        if raw_password:
            password_pattern = r'^(?=.*\d)(?=.*[A-Z])(?=.*[a-z])(?=.*[@#$%^&+=!_]).{8,128}$'
            if not re.match(password_pattern, raw_password):
                return jsonify({"error": "Password must be 8-128 chars long, include a number, uppercase, lowercase, and special character."}), 400
            if not isinstance(current_password, str) or not current_password:
                return jsonify({"error": "Enter your current password to set a new password."}), 400
            student = conn.execute(
                'SELECT student_id, email, password, auth_version FROM students WHERE student_id=?', (g.student_id,)
            ).fetchone()
            if not student or not bcrypt.check_password_hash(student['password'], current_password):
                return jsonify({"error": "Current password is incorrect."}), 403
            password = bcrypt.generate_password_hash(raw_password).decode("utf-8")
            conn.execute("""
                UPDATE students SET name=?, education_level=?, password=?, auth_version=auth_version+1
                WHERE student_id=?
            """, (name, education_level, password, g.student_id))
            updated_student = conn.execute(
                'SELECT student_id, email, auth_version FROM students WHERE student_id=?', (g.student_id,)
            ).fetchone()
        else:
            conn.execute("UPDATE students SET name=?, education_level=? WHERE student_id=?", (name, education_level, g.student_id))
            updated_student = None
            
        conn.commit()
        response = {"message": "Profile updated successfully", "name": name, "education_level": education_level}
        if updated_student:
            response['token'] = issue_token(updated_student)
        return jsonify(response), 200
    except Exception as e:
        conn.rollback()
        app.logger.exception('Unhandled profile update error')
        return jsonify({"error": "Internal server error"}), 500
    finally:
        conn.close()

@app.route("/save-subjects", methods=["POST"])
@auth_required
def save_subjects():
    data = request.get_json(silent=True) or {}
    email = g.user_email
    subjects_list = data.get("subjects")
    validation_error = validate_subjects_payload(subjects_list)
    if validation_error:
        return jsonify({'error': validation_error}), 400
    
    conn = get_db()
    student = conn.execute("SELECT student_id FROM students WHERE lower(email)=?", (email,)).fetchone()
    if student:
        sid = student["student_id"]
        conn.execute("DELETE FROM topics WHERE subject_id IN (SELECT subject_id FROM subjects WHERE student_id=?)", (sid,))
        conn.execute("DELETE FROM subjects WHERE student_id=?", (sid,))
        for s in subjects_list:
            cursor = conn.execute("INSERT INTO subjects (student_id, subject_name, difficulty, exam_date) VALUES (?, ?, ?, ?)", 
                         (sid, s.get('name', ''), s.get('difficulty', ''), s.get('examDate', '')))
            sub_id = cursor.lastrowid
            for t in s.get('topics', []):
                conn.execute("INSERT INTO topics (subject_id, topic_name) VALUES (?, ?)", (sub_id, t.get('name', '')))
    
    else:
        conn.close()
        return jsonify({'error': 'Student not found'}), 404
    conn.commit()
    conn.close()
    return jsonify({"message": "Saved"}), 200

@app.route("/get-subjects/<email>", methods=["GET"])
@auth_required
def get_subjects(email):
    email = email.strip().lower()
    conn = get_db()
    student = conn.execute("SELECT student_id FROM students WHERE lower(email)=?", (email,)).fetchone()
    subjects_list = []
    if student:
        sid = student["student_id"]
        subs = conn.execute("SELECT subject_id, subject_name as name, difficulty, exam_date as examDate FROM subjects WHERE student_id=?", (sid,)).fetchall()
        for sub in subs:
            tops = conn.execute("SELECT topic_id, topic_name as name FROM topics WHERE subject_id=?", (sub["subject_id"],)).fetchall()
            topics_list = [{"id": t["topic_id"], "name": t["name"]} for t in tops]
            subjects_list.append({
                "name": sub["name"],
                "difficulty": sub["difficulty"],
                "examDate": sub["examDate"],
                "topics": topics_list
            })
    conn.close()
    return jsonify(subjects_list)


# ── SYLLABUS INTELLIGENCE (OPTIONAL REFERENCE LAYER) ────────────────────────

def _normal(value):
    return syllabus_intelligence.normalized(value)


def _manual_subjects(conn, student_id):
    rows = conn.execute("""
        SELECT s.subject_name, t.topic_name
        FROM subjects s LEFT JOIN topics t ON t.subject_id=s.subject_id
        WHERE s.student_id=? ORDER BY s.subject_id, t.topic_id
    """, (student_id,)).fetchall()
    grouped = {}
    for row in rows:
        grouped.setdefault(row['subject_name'], [])
        if row['topic_name']:
            grouped[row['subject_name']].append(row['topic_name'])
    return grouped


def _latest_confirmed_syllabus(conn, student_id):
    return conn.execute("""
        SELECT * FROM syllabus_documents
        WHERE student_id=? AND status='confirmed'
        ORDER BY syllabus_id DESC LIMIT 1
    """, (student_id,)).fetchone()


def _syllabus_catalog(conn, student_id, syllabus_id):
    return conn.execute("""
        SELECT stm.syllabus_topic_id, stm.subject_name, stm.unit_name, stm.chapter_name, stm.topic_name,
               COALESCE(tps.pyq_frequency, 0) AS pyq_frequency,
               COALESCE(tps.importance, 'low') AS importance,
               COALESCE(tps.priority_signal, 0) AS priority_signal,
               COALESCE(tps.evidence_json, '[]') AS evidence_json
        FROM syllabus_topic_map stm
        LEFT JOIN topic_priority_signals tps
            ON tps.syllabus_topic_id=stm.syllabus_topic_id AND tps.student_id=stm.student_id
        WHERE stm.student_id=? AND stm.syllabus_id=?
        ORDER BY stm.subject_name, stm.unit_name, stm.chapter_name, stm.topic_name
    """, (student_id, syllabus_id)).fetchall()


def _rebuild_pyq_priority_signals(conn, student_id, syllabus_id):
    """Recalculate current-syllabus PYQ signals from retained document analyses.

    This makes removal of a wrong or obsolete paper reversible without leaving
    stale priority weight in a student's future study plans.
    """
    topic_rows = conn.execute("""
        SELECT syllabus_topic_id FROM syllabus_topic_map
        WHERE student_id=? AND syllabus_id=?
    """, (student_id, syllabus_id)).fetchall()
    topic_ids = {row['syllabus_topic_id'] for row in topic_rows}
    if not topic_ids:
        return
    placeholders = ','.join('?' for _ in topic_ids)
    conn.execute(
        f'DELETE FROM topic_priority_signals WHERE student_id=? AND syllabus_topic_id IN ({placeholders})',
        (student_id, *topic_ids),
    )
    documents = conn.execute("""
        SELECT analysis_json FROM pyq_documents
        WHERE student_id=? AND syllabus_id=? ORDER BY pyq_id
    """, (student_id, syllabus_id)).fetchall()
    importance_score = {'low': 0.5, 'medium': 1.0, 'high': 2.0}
    aggregates = {}
    for document in documents:
        try:
            mappings = json.loads(document['analysis_json']).get('mappings', [])
        except (TypeError, json.JSONDecodeError):
            continue
        if not isinstance(mappings, list):
            continue
        for mapping in mappings:
            if not isinstance(mapping, dict):
                continue
            topic_id = mapping.get('syllabus_topic_id')
            if topic_id not in topic_ids:
                continue
            try:
                frequency = int(mapping.get('frequency', 0))
            except (TypeError, ValueError):
                continue
            if frequency < 1:
                continue
            importance = str(mapping.get('importance', 'low')).casefold()
            if importance not in importance_score:
                importance = 'low'
            aggregate = aggregates.setdefault(topic_id, {'frequency': 0, 'importance': 'low', 'signal': 0.0, 'evidence': []})
            aggregate['frequency'] += frequency
            if importance_score[importance] >= aggregate['signal']:
                aggregate['importance'] = importance
                aggregate['signal'] = importance_score[importance]
            evidence = mapping.get('evidence', [])
            if isinstance(evidence, list):
                aggregate['evidence'].extend(str(item)[:300] for item in evidence if str(item).strip())
    for topic_id, aggregate in aggregates.items():
        conn.execute("""
            INSERT INTO topic_priority_signals (
                student_id, syllabus_topic_id, pyq_frequency, importance, priority_signal, evidence_json, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        """, (
            student_id, topic_id, aggregate['frequency'], aggregate['importance'], aggregate['signal'],
            json.dumps(aggregate['evidence'][:20], ensure_ascii=False),
        ))


def _subject_present(subject_name, catalog):
    return any(_normal(row['subject_name']) == _normal(subject_name) for row in catalog)


def _topic_match(subject_name, topic_name, catalog):
    """Map user topic to a confirmed exact topic, chapter, or unit—never a guess."""
    subject_rows = [row for row in catalog if _normal(row['subject_name']) == _normal(subject_name)]
    target = _normal(topic_name)
    exact_topics = [row for row in subject_rows if _normal(row['topic_name']) == target]
    if exact_topics:
        return exact_topics
    # A learner may enter a chapter/unit while the PDF lists subtopics underneath it.
    grouped = [row for row in subject_rows if _normal(row['chapter_name']) == target or _normal(row['unit_name']) == target]
    return grouped


def _priority_from_rows(rows):
    if not rows:
        return 0.0
    return min(2.0, max(float(row['priority_signal'] or 0) for row in rows))


def _apply_syllabus_intelligence(conn, student_id, subjects):
    """Return a copy of user subjects with bounded optional topic signals."""
    syllabus = _latest_confirmed_syllabus(conn, student_id)
    if not syllabus:
        return subjects, []
    catalog = _syllabus_catalog(conn, student_id, syllabus['syllabus_id'])
    warnings_list, enriched = [], []
    for subject in subjects:
        copied = {**subject, 'topics': []}
        subject_name = subject.get('name', '')
        if not _subject_present(subject_name, catalog):
            warnings_list.append({
                'type': 'subject_not_found', 'subject': subject_name,
                'message': f'{subject_name} was not found in your confirmed syllabus.'
            })
        for topic in subject.get('topics', []):
            topic_data = dict(topic) if isinstance(topic, dict) else {'name': str(topic)}
            matches = _topic_match(subject_name, topic_data.get('name', ''), catalog)
            if _subject_present(subject_name, catalog) and not matches:
                warnings_list.append({
                    'type': 'topic_not_found', 'subject': subject_name, 'topic': topic_data.get('name', ''),
                    'message': f"{topic_data.get('name', '')} was not found in the confirmed {subject_name} syllabus."
                })
            # Planner accepts 0–2 only: an importance nudge, never raw PYQ counts.
            topic_data['prioritySignal'] = _priority_from_rows(matches)
            topic_data['syllabusConfirmed'] = bool(matches)
            copied['topics'].append(topic_data)
        enriched.append(copied)
    return enriched, warnings_list


def _syllabus_summary(structure):
    rows = syllabus_intelligence.flatten_syllabus(structure)
    return {
        'subjectCount': len(structure.get('subjects', [])),
        'topicCount': len(rows),
        'subjects': [item['name'] for item in structure.get('subjects', [])],
        'uncertainties': structure.get('uncertainties', []),
    }


@app.route('/syllabus/analyze', methods=['POST'])
@auth_required
@rate_limit(10, 60 * 60)
def analyze_syllabus():
    if not GEMINI_API_KEY:
        return jsonify({'error': 'AI analysis is not configured. Existing Planify planning still works normally.'}), 503
    uploaded = request.files.get('file')
    try:
        document = syllabus_intelligence.read_upload(uploaded)
    except syllabus_intelligence.IntelligenceError as error:
        return jsonify({'error': str(error)}), 400

    conn = get_db()
    try:
        existing = conn.execute("""
            SELECT syllabus_id, status, extracted_json FROM syllabus_documents
            WHERE student_id=? AND content_hash=? AND status IN ('pending_review', 'confirmed')
            ORDER BY syllabus_id DESC LIMIT 1
        """, (g.student_id, document['sha256'])).fetchone()
        if existing:
            if existing['status'] == 'confirmed':
                return jsonify({'error': 'This exact syllabus is already confirmed. Upload a revised file to replace it.'}), 409
            extracted = json.loads(existing['extracted_json'])
            manual = _manual_subjects(conn, g.student_id)
            extracted_subjects = {_normal(item['name']) for item in extracted['subjects']}
            missing = [name for name in manual if _normal(name) not in extracted_subjects]
            return jsonify({
                'analysisId': existing['syllabus_id'], 'status': 'pending_review',
                'summary': _syllabus_summary(extracted), 'structure': extracted,
                'missingSubjects': missing, 'canConfirm': not missing,
                'reusedAnalysis': True,
            }), 200
    except (json.JSONDecodeError, KeyError, TypeError):
        return jsonify({'error': 'The saved syllabus analysis is invalid. Upload the syllabus again.'}), 400
    finally:
        conn.close()

    try:
        extracted = syllabus_intelligence.canonical_syllabus(
            syllabus_intelligence.run_ai_analysis(genai, syllabus_intelligence.syllabus_prompt(), document)
        )
    except syllabus_intelligence.IntelligenceError as error:
        return jsonify({'error': str(error)}), 400

    conn = get_db()
    try:
        cur = conn.execute("""
            INSERT INTO syllabus_documents (
                student_id, original_filename, content_hash, source_type, status, extracted_json
            ) VALUES (?, ?, ?, ?, 'pending_review', ?)
        """, (
            g.student_id, secure_filename(document['filename']) or 'syllabus-upload', document['sha256'],
            document['extension'], json.dumps(extracted, ensure_ascii=False),
        ))
        manual = _manual_subjects(conn, g.student_id)
        extracted_subjects = {_normal(item['name']) for item in extracted['subjects']}
        missing = [name for name in manual if _normal(name) not in extracted_subjects]
        conn.commit()
        return jsonify({
            'analysisId': cur.lastrowid,
            'status': 'pending_review',
            'summary': _syllabus_summary(extracted),
            'structure': extracted,
            'missingSubjects': missing,
            'canConfirm': not missing,
        }), 200
    finally:
        conn.close()


@app.route('/syllabus/confirm', methods=['POST'])
@auth_required
def confirm_syllabus():
    data = request.get_json(silent=True) or {}
    try:
        syllabus_id = int(data.get('syllabusId'))
    except (TypeError, ValueError):
        return jsonify({'error': 'A valid syllabusId is required'}), 400
    conn = get_db()
    try:
        document = conn.execute("SELECT * FROM syllabus_documents WHERE syllabus_id=? AND student_id=?", (syllabus_id, g.student_id)).fetchone()
        if not document:
            return jsonify({'error': 'Syllabus analysis not found'}), 404
        structure = json.loads(document['extracted_json'])
        manual = _manual_subjects(conn, g.student_id)
        subject_keys = {_normal(item['name']) for item in structure.get('subjects', [])}
        missing = [name for name in manual if _normal(name) not in subject_keys]
        if missing:
            return jsonify({
                'error': 'Every current Planify subject must exist in the complete uploaded syllabus before confirmation.',
                'missingSubjects': missing,
            }), 422

        conn.execute("UPDATE syllabus_documents SET status='superseded' WHERE student_id=? AND status='confirmed'", (g.student_id,))
        conn.execute("UPDATE syllabus_documents SET status='confirmed', confirmed_at=CURRENT_TIMESTAMP WHERE syllabus_id=?", (syllabus_id,))
        for row in syllabus_intelligence.flatten_syllabus(structure):
            conn.execute("""
                INSERT OR IGNORE INTO syllabus_topic_map (
                    syllabus_id, student_id, subject_name, unit_name, chapter_name, topic_name
                ) VALUES (?, ?, ?, ?, ?, ?)
            """, (syllabus_id, g.student_id, row['subject'], row['unit'], row['chapter'], row['topic']))
        conn.commit()
        return jsonify({'message': 'Syllabus confirmed', 'syllabusId': syllabus_id, 'summary': _syllabus_summary(structure)}), 200
    except (json.JSONDecodeError, TypeError, KeyError):
        conn.rollback()
        return jsonify({'error': 'The saved syllabus analysis is invalid. Please upload it again.'}), 400
    finally:
        conn.close()


@app.route('/syllabus/intelligence', methods=['GET'])
@auth_required
def get_syllabus_intelligence():
    conn = get_db()
    try:
        document = _latest_confirmed_syllabus(conn, g.student_id)
        if not document:
            return jsonify({'configured': False, 'summary': None, 'manualSubjects': [], 'prioritySignals': []}), 200
        structure = json.loads(document['extracted_json'])
        catalog = _syllabus_catalog(conn, g.student_id, document['syllabus_id'])
        manual = _manual_subjects(conn, g.student_id)
        manual_subjects = []
        for subject_name, topics in manual.items():
            subject_found = _subject_present(subject_name, catalog)
            manual_subjects.append({
                'name': subject_name,
                'inSyllabus': subject_found,
                'topics': [{
                    'name': topic,
                    'inSyllabus': bool(_topic_match(subject_name, topic, catalog)),
                    'prioritySignal': _priority_from_rows(_topic_match(subject_name, topic, catalog)),
                } for topic in topics],
            })
        signals = [dict(row) for row in sorted(catalog, key=lambda row: (float(row['priority_signal'] or 0), int(row['pyq_frequency'] or 0)), reverse=True) if float(row['priority_signal'] or 0) > 0][:20]
        for signal in signals:
            try:
                signal['evidence'] = json.loads(signal.pop('evidence_json'))
            except json.JSONDecodeError:
                signal['evidence'] = []
        pyq_documents = []
        for row in conn.execute("""
            SELECT pyq_id, original_filename, paper_label, created_at, analysis_json
            FROM pyq_documents WHERE student_id=? AND syllabus_id=? ORDER BY pyq_id DESC
        """, (g.student_id, document['syllabus_id'])).fetchall():
            try:
                mapping_count = len(json.loads(row['analysis_json']).get('mappings', []))
            except (TypeError, json.JSONDecodeError):
                mapping_count = 0
            pyq_documents.append({
                'pyqId': row['pyq_id'], 'filename': row['original_filename'],
                'label': row['paper_label'], 'createdAt': row['created_at'], 'mappingCount': mapping_count,
            })
        return jsonify({
            'configured': True, 'syllabusId': document['syllabus_id'], 'summary': _syllabus_summary(structure),
            'manualSubjects': manual_subjects, 'prioritySignals': signals, 'pyqDocuments': pyq_documents,
        }), 200
    finally:
        conn.close()


@app.route('/syllabus/pyq/<int:pyq_id>', methods=['DELETE'])
@auth_required
def delete_pyq_document(pyq_id):
    conn = get_db()
    try:
        syllabus = _latest_confirmed_syllabus(conn, g.student_id)
        if not syllabus:
            return jsonify({'error': 'No confirmed syllabus was found'}), 404
        document = conn.execute("""
            SELECT pyq_id FROM pyq_documents
            WHERE pyq_id=? AND student_id=? AND syllabus_id=?
        """, (pyq_id, g.student_id, syllabus['syllabus_id'])).fetchone()
        if not document:
            return jsonify({'error': 'PYQ paper not found for your current syllabus'}), 404
        conn.execute('DELETE FROM pyq_documents WHERE pyq_id=? AND student_id=?', (pyq_id, g.student_id))
        _rebuild_pyq_priority_signals(conn, g.student_id, syllabus['syllabus_id'])
        conn.commit()
        return jsonify({'message': 'PYQ paper removed and priorities recalculated'}), 200
    finally:
        conn.close()


@app.route('/syllabus/pyq', methods=['POST'])
@auth_required
@rate_limit(10, 60 * 60)
def analyze_pyq():
    if not GEMINI_API_KEY:
        return jsonify({'error': 'AI analysis is not configured. Existing Planify planning still works normally.'}), 503
    uploads = request.files.getlist('files') or ([request.files.get('file')] if request.files.get('file') else [])
    uploads = [item for item in uploads if item and item.filename]
    if not 1 <= len(uploads) <= syllabus_intelligence.MAX_PYQ_FILES:
        return jsonify({'error': f'Upload between 1 and {syllabus_intelligence.MAX_PYQ_FILES} PYQ files at a time'}), 400
    paper_label = ' '.join((request.form.get('label') or '').split())[:120]
    conn = get_db()
    try:
        syllabus = _latest_confirmed_syllabus(conn, g.student_id)
        if not syllabus:
            return jsonify({'error': 'Confirm a syllabus before analysing PYQs'}), 409
        catalog_rows = _syllabus_catalog(conn, g.student_id, syllabus['syllabus_id'])
        # The AI contract uses concise semantic keys; keep the database field
        # names inside the database layer only.
        catalog = [{
            'syllabus_topic_id': row['syllabus_topic_id'],
            'subject': row['subject_name'], 'unit': row['unit_name'],
            'chapter': row['chapter_name'], 'topic': row['topic_name'],
        } for row in catalog_rows]
        if not catalog:
            return jsonify({'error': 'Confirmed syllabus has no topics to map PYQs against'}), 409

        documents = []
        seen_hashes = set()
        for uploaded in uploads:
            document = syllabus_intelligence.read_upload(uploaded)
            if document['sha256'] in seen_hashes:
                return jsonify({'error': 'The same PYQ paper was selected more than once. Remove the duplicate and retry.'}), 409
            seen_hashes.add(document['sha256'])
            duplicate = conn.execute("""
                SELECT pyq_id FROM pyq_documents
                WHERE student_id=? AND syllabus_id=? AND content_hash=?
            """, (g.student_id, syllabus['syllabus_id'], document['sha256'])).fetchone()
            if duplicate:
                return jsonify({'error': 'This PYQ paper has already been analysed for the current syllabus. Remove it first if you need to analyse it again.'}), 409
            documents.append(document)

        analyses = []
        for document in documents:
            analysis = syllabus_intelligence.canonical_pyq(
                syllabus_intelligence.run_ai_analysis(genai, syllabus_intelligence.pyq_prompt(catalog), document), catalog
            )
            analyses.append((document, analysis))

        importance_score = {'low': 0.5, 'medium': 1.0, 'high': 2.0}
        for document, analysis in analyses:
            conn.execute("""
                INSERT INTO pyq_documents (
                    student_id, syllabus_id, original_filename, content_hash, source_type, paper_label, analysis_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                g.student_id, syllabus['syllabus_id'], secure_filename(document['filename']) or 'pyq-upload',
                document['sha256'], document['extension'], paper_label, json.dumps(analysis, ensure_ascii=False),
            ))
            for mapping in analysis['mappings']:
                topic_id = mapping['syllabus_topic_id']
                existing = conn.execute("""
                    SELECT pyq_frequency, priority_signal, importance, evidence_json
                    FROM topic_priority_signals WHERE student_id=? AND syllabus_topic_id=?
                """, (g.student_id, topic_id)).fetchone()
                previous_frequency = int(existing['pyq_frequency']) if existing else 0
                previous_signal = float(existing['priority_signal']) if existing else 0.0
                previous_evidence = json.loads(existing['evidence_json']) if existing else []
                new_signal = max(previous_signal, importance_score[mapping['importance']])
                evidence = (previous_evidence + mapping['evidence'])[:20]
                conn.execute("""
                    INSERT INTO topic_priority_signals (
                        student_id, syllabus_topic_id, pyq_frequency, importance, priority_signal, evidence_json, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(student_id, syllabus_topic_id) DO UPDATE SET
                        pyq_frequency=excluded.pyq_frequency,
                        importance=excluded.importance,
                        priority_signal=excluded.priority_signal,
                        evidence_json=excluded.evidence_json,
                        updated_at=CURRENT_TIMESTAMP
                """, (
                    g.student_id, topic_id, previous_frequency + mapping['frequency'], mapping['importance'],
                    new_signal, json.dumps(evidence, ensure_ascii=False),
                ))
        conn.commit()
        updated_catalog = _syllabus_catalog(conn, g.student_id, syllabus['syllabus_id'])
        signals = [dict(row) for row in updated_catalog if float(row['priority_signal'] or 0) > 0]
        return jsonify({
            'message': 'PYQ analysis completed', 'documentsAnalyzed': len(analyses),
            'mappedTopics': sum(len(analysis['mappings']) for _, analysis in analyses),
            'prioritySignals': signals,
        }), 200
    except syllabus_intelligence.IntelligenceError as error:
        conn.rollback()
        return jsonify({'error': str(error)}), 400
    except (json.JSONDecodeError, TypeError, KeyError, ValueError):
        conn.rollback()
        return jsonify({'error': 'PYQ analysis could not be saved safely. Please retry.'}), 400
    finally:
        conn.close()

# ── PLANNING SERVICE ENDPOINTS (BACKEND-DRIVEN) ──────────────────────────────

@app.route("/generate-plan", methods=["POST"])
@auth_required
def generate_plan():
    try:
        data = request.get_json(silent=True) or {}
        email = g.user_email
        try:
            sleep_hours = validate_sleep_hours(data.get("sleepHours"))
        except ValueError as validation_error:
            return jsonify({'error': str(validation_error)}), 400
        
        conn = get_db()
        student = conn.execute("SELECT student_id FROM students WHERE lower(email)=?", (email,)).fetchone()
        if not student:
            conn.close()
            return jsonify({"error": "Student not found"}), 404
        sid = student["student_id"]
        
        subjects = data.get("subjects")
        if not subjects:
            subs = conn.execute("SELECT subject_id, subject_name as name, difficulty, exam_date as examDate FROM subjects WHERE student_id=?", (sid,)).fetchall()
            subjects = []
            for sub in subs:
                tops = conn.execute("SELECT topic_name as name FROM topics WHERE subject_id=?", (sub["subject_id"],)).fetchall()
                subjects.append({
                    "name": sub["name"],
                    "difficulty": sub["difficulty"],
                    "examDate": sub["examDate"],
                    "topics": [{"name": t["name"]} for t in tops]
                })
        
        if not subjects:
            conn.close()
            return jsonify({"error": "Please add subjects first"}), 400

        validation_error = validate_subjects_payload(subjects)
        if validation_error:
            conn.close()
            return jsonify({'error': validation_error}), 400

        # Optional, bounded syllabus/PYQ signals enrich the existing scheduler.
        # Missing syllabus matches only create warnings; user-entered topics stay intact.
        subjects, syllabus_warnings = _apply_syllabus_intelligence(conn, sid, subjects)
        schedule_result = planner.generate_study_schedule(subjects, sleep_hours)
        week = schedule_result["week"]
        total_tasks = schedule_result["total_tasks"]
        total_mins = schedule_result["total_mins"]
        start_date = week[0]["date"] if week else None
        
        cur = conn.execute("""
            INSERT INTO study_plans (student_id, total_days, sleep_hours, start_date, total_tasks, total_mins)
            VALUES (?, 7, ?, ?, ?, ?)
        """, (sid, sleep_hours, start_date, total_tasks, total_mins))
        plan_id = cur.lastrowid
        
        conn.execute("DELETE FROM tasks WHERE student_id=?", (sid,))
        for day_obj in week:
            task_date = day_obj["date"]
            for phase_idx, phase_obj in enumerate(day_obj["phases"]):
                for task in phase_obj["tasks"]:
                    conn.execute("""
                        INSERT INTO tasks (
                            plan_id, student_id, task_ref_id, task_name, subject_name,
                            phase_index, task_date, duration_mins, difficulty,
                            is_critical, is_rescheduled, status
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending')
                    """, (
                        plan_id, sid, task["id"], task["name"], task.get("subjectName", ""),
                        phase_idx, task_date, task.get("durationMins", 45),
                        task.get("difficulty", "Medium"),
                        1 if task.get("isCritical") else 0,
                        1 if task.get("isSkipped") else 0
                    ))
        
        conn.execute("""
            INSERT INTO task_progress (student_id, completed_tasks, skipped_tasks, total_tasks)
            VALUES (?, '{}', '[]', ?)
            ON CONFLICT(student_id) DO UPDATE SET
                completed_tasks = '{}',
                skipped_tasks = '[]',
                total_tasks = ?,
                updated_at = CURRENT_TIMESTAMP
        """, (sid, total_tasks, total_tasks))
        
        simple_plan = [{
            "name": s["name"],
            "difficulty": s["difficulty"],
            "examDate": s.get("examDate") or s.get("exam_date"),
            "hours": 5 if s["difficulty"] == "Hard" else 3 if s["difficulty"] == "Medium" else 2,
            "topics": s.get("topics", [])
        } for s in subjects]
        conn.execute("INSERT INTO history (student_id, data) VALUES (?, ?)", (sid, json.dumps(simple_plan)))
        
        conn.commit()
        conn.close()
        return jsonify({
            "message": "Plan generated successfully",
            "planId": plan_id,
            "schedule": schedule_result,
            "plan": simple_plan,
            "totalTasks": total_tasks,
            "syllabusWarnings": syllabus_warnings,
        }), 200
    except Exception as e:
        app.logger.exception("Plan generation error")
        return jsonify({"error": "Internal server error"}), 500

@app.route("/get-active-schedule/<email>", methods=["GET"])
@auth_required
def get_active_schedule(email):
    email = email.strip().lower()
    conn = get_db()
    student = conn.execute("SELECT student_id FROM students WHERE lower(email)=?", (email,)).fetchone()
    if not student:
        conn.close()
        return jsonify({"week": []})
        
    sid = student["student_id"]
    prog_row = conn.execute("SELECT * FROM task_progress WHERE student_id=?", (sid,)).fetchone()
    skipped_list = json.loads(prog_row["skipped_tasks"]) if prog_row and prog_row["skipped_tasks"] else []
    schedule_res, sleep_hours, completed_map = load_active_schedule(conn, sid)
    conn.close()
    return jsonify({
        "schedule": schedule_res,
        "sleepHours": sleep_hours,
        "completedTasks": completed_map,
        "skippedTasks": skipped_list
    })


@app.route("/reset-dashboard", methods=["POST"])
@auth_required
def reset_dashboard():
    """Clear the active curriculum and task state without deleting historical records."""
    conn = get_db()
    try:
        sid = g.student_id
        conn.execute("DELETE FROM topics WHERE subject_id IN (SELECT subject_id FROM subjects WHERE student_id=?)", (sid,))
        conn.execute("DELETE FROM subjects WHERE student_id=?", (sid,))
        conn.execute("DELETE FROM tasks WHERE student_id=?", (sid,))
        conn.execute("DELETE FROM study_plans WHERE student_id=?", (sid,))
        conn.execute("""
            INSERT INTO task_progress (student_id, completed_tasks, skipped_tasks, total_tasks)
            VALUES (?, '{}', '[]', 0)
            ON CONFLICT(student_id) DO UPDATE SET
                completed_tasks='{}', skipped_tasks='[]', total_tasks=0, updated_at=CURRENT_TIMESTAMP
        """, (sid,))
        conn.execute("""
            INSERT INTO progress (student_id, completed_hours, total_hours, percentage)
            VALUES (?, 0, 0, 0)
            ON CONFLICT(student_id) DO UPDATE SET
                completed_hours=0, total_hours=0, percentage=0
        """, (sid,))
        conn.commit()
        return jsonify({"message": "Dashboard reset successfully"}), 200
    except Exception:
        conn.rollback()
        app.logger.exception('Dashboard reset error')
        return jsonify({"error": "Unable to reset the dashboard"}), 500
    finally:
        conn.close()

@app.route("/toggle-task", methods=["POST"])
@auth_required
def toggle_task():
    try:
        data = request.get_json(silent=True) or {}
        email = g.user_email
        task_id = data.get("taskId")
        completed = data.get("completed")
        
        if not isinstance(task_id, str) or not task_id.strip() or not isinstance(completed, bool):
            return jsonify({"error": "taskId and boolean completed are required"}), 400
            
        conn = get_db()
        student = conn.execute("SELECT student_id FROM students WHERE lower(email)=?", (email,)).fetchone()
        if not student:
            conn.close()
            return jsonify({"error": "Student not found"}), 404
            
        sid = student["student_id"]
        task = conn.execute("SELECT status FROM tasks WHERE student_id=? AND task_ref_id=?", (sid, task_id)).fetchone()
        if not task:
            conn.close()
            return jsonify({"error": "Task not found in the active schedule"}), 404
        
        new_status = "Completed" if completed else "Pending"
        conn.execute("UPDATE tasks SET status=? WHERE student_id=? AND task_ref_id=?", (new_status, sid, task_id))
        
        prog_row = conn.execute("SELECT completed_tasks, total_tasks FROM task_progress WHERE student_id=?", (sid,)).fetchone()
        completed_map = json.loads(prog_row["completed_tasks"]) if prog_row and prog_row["completed_tasks"] else {}
        if completed:
            completed_map[task_id] = True
        else:
            completed_map.pop(task_id, None)
        
        conn.execute("""
            UPDATE task_progress SET completed_tasks=?, updated_at=CURRENT_TIMESTAMP WHERE student_id=?
        """, (json.dumps(completed_map), sid))
        
        stats = conn.execute("SELECT xp, level FROM user_stats WHERE student_id=?", (sid,)).fetchone()
        current_xp = stats["xp"] if stats else 0
        previous_completed = task['status'] == 'Completed'
        if completed and not previous_completed:
            new_xp = current_xp + 10
        elif not completed and previous_completed:
            new_xp = max(0, current_xp - 10)
        else:
            new_xp = current_xp
        new_level = (new_xp // 500) + 1
        
        conn.execute("""
            INSERT INTO user_stats (student_id, xp, level, badges)
            VALUES (?, ?, ?, '[]')
            ON CONFLICT(student_id) DO UPDATE SET xp=?, level=?
        """, (sid, new_xp, new_level, new_xp, new_level))
        
        conn.commit()
        conn.close()
        
        return jsonify({
            "success": True,
            "taskId": task_id,
            "completed": completed,
            "xp": new_xp,
            "level": new_level,
            "completedTasks": completed_map
        }), 200
    except Exception as e:
        app.logger.exception("Toggle task error")
        return jsonify({"error": "Internal server error"}), 500

@app.route("/skip-task", methods=["POST"])
@auth_required
def skip_task():
    try:
        data = request.get_json(silent=True) or {}
        email = g.user_email
        task_id = data.get("taskId")
        try:
            sleep_hours = validate_sleep_hours(data.get("sleepHours"))
        except ValueError as validation_error:
            return jsonify({'error': str(validation_error)}), 400
        
        if not isinstance(task_id, str) or not task_id.strip():
            return jsonify({"error": "taskId is required"}), 400
            
        conn = get_db()
        student = conn.execute("SELECT student_id FROM students WHERE lower(email)=?", (email,)).fetchone()
        if not student:
            conn.close()
            return jsonify({"error": "Student not found"}), 404
        sid = student["student_id"]
        
        task = conn.execute("""
            SELECT task_id, plan_id, task_ref_id, task_name, phase_index, task_date,
                   duration_mins, status
            FROM tasks WHERE student_id=? AND task_ref_id=?
        """, (sid, task_id)).fetchone()
        if not task:
            conn.close()
            return jsonify({"error": "Task not found in the active schedule"}), 404
        if task['status'] == 'Completed':
            conn.close()
            return jsonify({"error": "Completed tasks cannot be rescheduled"}), 409
        plan = conn.execute("SELECT sleep_hours FROM study_plans WHERE plan_id=?", (task['plan_id'],)).fetchone()
        if not plan:
            conn.close()
            return jsonify({"error": "Active plan not found"}), 404
        phase_limits = planner.calculate_phase_limits(plan['sleep_hours'])
        usage_rows = conn.execute("""
            SELECT task_date, phase_index, COALESCE(SUM(duration_mins), 0) AS used_mins
            FROM tasks WHERE student_id=? AND plan_id=? AND task_id != ?
            GROUP BY task_date, phase_index
        """, (sid, task['plan_id'], task['task_id'])).fetchall()
        usage = {(row['task_date'], row['phase_index']): row['used_mins'] for row in usage_rows}
        date_rows = conn.execute("""
            SELECT DISTINCT task_date FROM tasks
            WHERE student_id=? AND plan_id=? AND task_date>=?
            ORDER BY task_date ASC
        """, (sid, task['plan_id'], task['task_date'])).fetchall()
        target_phase = min(task['phase_index'] + 1, 3)
        destination = None
        for date_row in date_rows:
            candidate_date = date_row['task_date']
            first_phase = target_phase if candidate_date == task['task_date'] else 0
            for candidate_phase in range(first_phase, 4):
                if phase_limits[candidate_phase] - usage.get((candidate_date, candidate_phase), 0) >= task['duration_mins']:
                    destination = (candidate_date, candidate_phase)
                    break
            if destination:
                break
        if not destination:
            conn.close()
            return jsonify({"error": "No remaining capacity is available to reschedule this task"}), 409

        prog_row = conn.execute("SELECT skipped_tasks FROM task_progress WHERE student_id=?", (sid,)).fetchone()
        skipped_list = json.loads(prog_row["skipped_tasks"]) if prog_row and prog_row["skipped_tasks"] else []
        skipped_list = [item for item in skipped_list if item.get('taskId') != task_id]
        skipped_list.append({
            "taskId": task_id, "fromPhase": task['phase_index'], "targetPhase": destination[1],
            "fromDate": task['task_date'], "toDate": destination[0],
        })
        task_name = task['task_name']
        if not task_name.startswith('↩️ Rescheduled: '):
            task_name = f'↩️ Rescheduled: {task_name}'
        conn.execute("""
            UPDATE tasks SET task_name=?, task_date=?, phase_index=?, is_rescheduled=1
            WHERE task_id=?
        """, (task_name, destination[0], destination[1], task['task_id']))
        
        conn.execute("UPDATE task_progress SET skipped_tasks=?, updated_at=CURRENT_TIMESTAMP WHERE student_id=?", (json.dumps(skipped_list), sid))
        
        schedule_res, _, _ = load_active_schedule(conn, sid)
        conn.commit()
        conn.close()
        
        return jsonify({
            "message": "Task rescheduled successfully",
            "schedule": schedule_res,
            "skippedTasks": skipped_list
        }), 200
    except Exception as e:
        app.logger.exception("Skip task error")
        return jsonify({"error": "Internal server error"}), 500

@app.route("/save-plan", methods=["POST"])
@auth_required
def save_plan():
    try:
        data = request.get_json(silent=True) or {}
        email = g.user_email
        plan_data = data.get("plan")
        validation_error = validate_plan_payload(plan_data)
        if validation_error:
            return jsonify({'error': validation_error}), 400
        
        conn = get_db()
        student = conn.execute("SELECT student_id FROM students WHERE lower(email)=?", (email,)).fetchone()
        if student:
            conn.execute("INSERT INTO history (student_id, data) VALUES (?, ?)", (student["student_id"], json.dumps(plan_data)))
        else:
            conn.close()
            return jsonify({"error": "Student not found in database"}), 404
        
        conn.commit()
        conn.close()
        return jsonify({"message": "Saved Successfully"}), 200
    except Exception as e:
        if 'conn' in locals():
            conn.rollback()
            conn.close()
        app.logger.exception('Unhandled plan save error')
        return jsonify({"error": "Internal server error"}), 500

@app.route("/get-plan/<email>", methods=["GET"])
@auth_required
def get_plan(email):
    email = email.strip().lower()
    conn = get_db()
    row = conn.execute("""
        SELECT h.data 
        FROM history h 
        JOIN students s ON h.student_id = s.student_id 
        WHERE lower(s.email)=? 
        ORDER BY h.created_at DESC, h.history_id DESC LIMIT 1
    """, (email,)).fetchone()
    conn.close()
    return jsonify(json.loads(row["data"])) if row else jsonify([])

@app.route("/get-history/<email>", methods=["GET"])
@auth_required
def get_history(email):
    conn = get_db()
    rows = conn.execute("""
        SELECT h.data, h.created_at 
        FROM history h 
        JOIN students s ON h.student_id = s.student_id 
        WHERE lower(s.email) = lower(?) 
        ORDER BY h.created_at DESC, h.history_id DESC
    """, (email,)).fetchall()
    conn.close()
    return jsonify([{"data": r["data"], "created_at": r["created_at"]} for r in rows])

# ── TASK PROGRESS ENDPOINTS ──────────────────────────────────────────────────

@app.route("/save-progress", methods=["POST"])
@auth_required
def save_progress():
    try:
        data = request.get_json(silent=True) or {}
        email = g.user_email
        completed_tasks = json.dumps(data.get("completedTasks", {}))
        skipped_tasks = json.dumps(data.get("skippedTasks", []))
        try:
            total_tasks = int(data.get("totalTasks", 0))
            completed_hours = bounded_number(data.get("completedHours", 0), 'completedHours')
            total_hours = bounded_number(data.get("totalHours", 0), 'totalHours')
            percentage = bounded_number(data.get("percentage", 0), 'percentage', maximum=100)
            if total_tasks < 0 or completed_hours > total_hours + 0.01:
                raise ValueError('Progress totals are inconsistent')
        except ValueError as validation_error:
            return jsonify({'error': str(validation_error)}), 400

        today_date = data.get("todayDate", "")
        try:
            today_hours = bounded_number(data.get("todayHours", 0), 'todayHours')
            today_tasks = int(data.get("todayTasks", 0))
            if today_tasks < 0:
                raise ValueError('todayTasks is outside the allowed range')
        except ValueError as validation_error:
            return jsonify({'error': str(validation_error)}), 400

        conn = get_db()
        student = conn.execute("SELECT student_id FROM students WHERE lower(email)=?", (email,)).fetchone()
        if not student:
            conn.close()
            return jsonify({"error": "Student not found"}), 404

        sid = student["student_id"]

        existing = conn.execute("SELECT id FROM task_progress WHERE student_id=?", (sid,)).fetchone()
        if existing:
            conn.execute("""
                UPDATE task_progress 
                SET completed_tasks=?, skipped_tasks=?, total_tasks=?, updated_at=CURRENT_TIMESTAMP 
                WHERE student_id=?
            """, (completed_tasks, skipped_tasks, total_tasks, sid))
        else:
            conn.execute("""
                INSERT INTO task_progress (student_id, completed_tasks, skipped_tasks, total_tasks) 
                VALUES (?, ?, ?, ?)
            """, (sid, completed_tasks, skipped_tasks, total_tasks))

        existing_prog = conn.execute("SELECT progress_id FROM progress WHERE student_id=?", (sid,)).fetchone()
        if existing_prog:
            conn.execute("""
                UPDATE progress 
                SET completed_hours=?, total_hours=?, percentage=? 
                WHERE student_id=?
            """, (completed_hours, total_hours, percentage, sid))
        else:
            conn.execute("""
                INSERT INTO progress (student_id, completed_hours, total_hours, percentage) 
                VALUES (?, ?, ?, ?)
            """, (sid, completed_hours, total_hours, percentage))

        if today_date:
            conn.execute("""
                INSERT INTO daily_stats (student_id, stat_date, hours_studied, tasks_completed)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(student_id, stat_date) DO UPDATE SET
                    hours_studied = ?,
                    tasks_completed = ?
            """, (sid, today_date, today_hours, today_tasks, today_hours, today_tasks))

        conn.commit()
        conn.close()
        return jsonify({"message": "Progress saved successfully"}), 200
    except Exception as e:
        if 'conn' in locals():
            conn.rollback()
            conn.close()
        app.logger.exception('Unhandled request error')
        return jsonify({"error": "Internal server error"}), 500

@app.route("/get-progress/<email>", methods=["GET"])
@auth_required
def get_progress(email):
    email = email.strip().lower()
    conn = get_db()
    student = conn.execute("SELECT student_id FROM students WHERE lower(email)=?", (email,)).fetchone()
    if not student:
        conn.close()
        return jsonify({"completedTasks": {}, "skippedTasks": [], "totalTasks": 0})

    row = conn.execute("SELECT * FROM task_progress WHERE student_id=?", (student["student_id"],)).fetchone()
    conn.close()

    if row:
        return jsonify({
            "completedTasks": json.loads(row["completed_tasks"]),
            "skippedTasks": json.loads(row["skipped_tasks"]),
            "totalTasks": row["total_tasks"]
        })
    return jsonify({"completedTasks": {}, "skippedTasks": [], "totalTasks": 0})

@app.route("/save-daily-stat", methods=["POST"])
@auth_required
def save_daily_stat():
    try:
        data = request.get_json(silent=True) or {}
        email = data.get("email", "").strip().lower()
        hours = data.get("hours", 0)
        tasks_done = data.get("tasksDone", 0)
        from datetime import date
        today = date.today().isoformat()

        conn = get_db()
        student = conn.execute("SELECT student_id FROM students WHERE lower(email)=?", (email,)).fetchone()
        if not student:
            conn.close()
            return jsonify({"error": "Student not found"}), 404

        sid = student["student_id"]
        conn.execute("""
            INSERT INTO daily_stats (student_id, stat_date, hours_studied, tasks_completed)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(student_id, stat_date) DO UPDATE SET
                hours_studied = ?,
                tasks_completed = ?
        """, (sid, today, hours, tasks_done, hours, tasks_done))

        conn.commit()
        conn.close()
        return jsonify({"message": "Daily stat saved"}), 200
    except Exception as e:
        if 'conn' in locals():
            conn.rollback()
            conn.close()
        app.logger.exception('Unhandled request error')
        return jsonify({"error": "Internal server error"}), 500

# ── GAMIFICATION ENDPOINTS ───────────────────────────────────────────────────

@app.route("/get-stats/<email>", methods=["GET"])
@auth_required
def get_stats(email):
    try:
        conn = get_db()
        student = conn.execute("SELECT student_id FROM students WHERE lower(email)=?", (email.strip().lower(),)).fetchone()
        if not student:
            conn.close()
            return jsonify({"error": "Student not found"}), 404
        
        sid = student["student_id"]
        stats = conn.execute("SELECT * FROM user_stats WHERE student_id=?", (sid,)).fetchone()
        
        if not stats:
            conn.execute("INSERT INTO user_stats (student_id, xp, level, badges) VALUES (?, 0, 1, '[]')", (sid,))
            conn.commit()
            stats = {"xp": 0, "level": 1, "badges": "[]"}
        
        conn.close()
        return jsonify({
            "xp": stats["xp"],
            "level": stats["level"],
            "badges": json.loads(stats["badges"]) if isinstance(stats["badges"], str) else []
        })
    except Exception as e:
        app.logger.exception('Unhandled request error')
        return jsonify({"error": "Internal server error"}), 500

@app.route("/save-stats", methods=["POST"])
@auth_required
def save_stats():
    try:
        data = request.get_json(silent=True) or {}
        email = data.get("email", "").strip().lower()
        try:
            xp = int(data.get("xp", 0))
            level = int(data.get("level", 1))
            if xp < 0 or level < 1 or xp > 10_000_000:
                raise ValueError('Invalid XP or level')
        except (TypeError, ValueError) as validation_error:
            return jsonify({'error': str(validation_error)}), 400
        badges = json.dumps(data.get("badges", []))
        
        conn = get_db()
        student = conn.execute("SELECT student_id FROM students WHERE lower(email)=?", (email,)).fetchone()
        if not student:
            conn.close()
            return jsonify({"error": "Student not found"}), 404
            
        sid = student["student_id"]
        
        conn.execute("""
            INSERT INTO user_stats (student_id, xp, level, badges)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(student_id) DO UPDATE SET
                xp = ?, level = ?, badges = ?
        """, (sid, xp, level, badges, xp, level, badges))
        
        conn.commit()
        conn.close()
        return jsonify({"message": "Stats saved successfully"}), 200
    except Exception as e:
        app.logger.exception('Unhandled request error')
        return jsonify({"error": "Internal server error"}), 500

@app.route("/analytics/<email>", methods=["GET"])
@auth_required
def get_analytics(email):
    try:
        conn = get_db()
        student = conn.execute("SELECT student_id FROM students WHERE lower(email)=?", (email.strip().lower(),)).fetchone()
        if not student:
            conn.close()
            return jsonify({"error": "Student not found"}), 404
        
        sid = student["student_id"]
        
        daily_records = conn.execute("SELECT stat_date, hours_studied, tasks_completed FROM daily_stats WHERE student_id=? ORDER BY stat_date DESC LIMIT 7", (sid,)).fetchall()
        daily_records.reverse()
        
        formatted_daily = []
        for r in daily_records:
            formatted_daily.append({
                "date": r["stat_date"],
                "hours": round(r["hours_studied"], 2),
                "tasks": r["tasks_completed"]
            })
            
        prog = conn.execute("SELECT completed_hours, total_hours, percentage FROM progress WHERE student_id=?", (sid,)).fetchone()
        overall = {
            "completed_hours": round(prog["completed_hours"], 2) if prog else 0,
            "total_hours": round(prog["total_hours"], 2) if prog else 0,
            "percentage": round(prog["percentage"], 2) if prog else 0
        }
        
        conn.close()
        return jsonify({
            "daily": formatted_daily,
            "overall": overall
        })
    except Exception as e:
        app.logger.exception('Unhandled request error')
        return jsonify({"error": "Internal server error"}), 500

# ── SPACED REPETITION ENDPOINTS ──────────────────────────────────────────────

@app.route("/get-reviews/<email>", methods=["GET"])
@auth_required
def get_reviews(email):
    try:
        conn = get_db()
        student = conn.execute("SELECT student_id FROM students WHERE lower(email)=?", (email.strip().lower(),)).fetchone()
        if not student:
            conn.close()
            return jsonify({"error": "Student not found"}), 404
            
        sid = student["student_id"]
        reviews = conn.execute("""
            SELECT * FROM review_queue
            WHERE student_id=?
            -- LOWER() works in both SQLite and PostgreSQL. SQLite's
            -- "COLLATE NOCASE" syntax caused the public PostgreSQL service
            -- to return a 500 error when opening Spaced Repetition.
            ORDER BY next_review_date ASC, LOWER(topic_name) ASC
        """, (sid,)).fetchall()
        
        res = []
        for r in reviews:
            res.append({
                "topic_name": r["topic_name"],
                "next_review_date": r["next_review_date"],
                "interval": r["interval"],
                "ease_factor": r["ease_factor"]
            })
            
        conn.close()
        return jsonify(res)
    except Exception as e:
        app.logger.exception('Unhandled request error')
        return jsonify({"error": "Internal server error"}), 500

@app.route("/save-review", methods=["POST"])
@auth_required
def save_review():
    try:
        data = request.get_json(silent=True) or {}
        email = data.get("email", "").strip().lower()
        topic_name = data.get("topic_name")
        next_review_date = data.get("next_review_date")
        interval = data.get("interval", 1)
        ease_factor = data.get("ease_factor", 2.5)
        try:
            from datetime import date
            date.fromisoformat(next_review_date)
            interval = int(interval)
            ease_factor = float(ease_factor)
            if not topic_name or len(str(topic_name).strip()) > 300 or interval < 1 or not 1.0 <= ease_factor <= 5.0:
                raise ValueError
        except (TypeError, ValueError):
            return jsonify({'error': 'Invalid review topic, date, interval, or ease factor'}), 400
        
        conn = get_db()
        student = conn.execute("SELECT student_id FROM students WHERE lower(email)=?", (email,)).fetchone()
        if not student:
            conn.close()
            return jsonify({"error": "Student not found"}), 404
            
        sid = student["student_id"]
        
        conn.execute("""
            INSERT INTO review_queue (student_id, topic_name, next_review_date, interval, ease_factor)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(student_id, topic_name) DO UPDATE SET
                next_review_date = ?,
                interval = ?,
                ease_factor = ?
        """, (sid, topic_name, next_review_date, interval, ease_factor, next_review_date, interval, ease_factor))
        
        conn.commit()
        conn.close()
        return jsonify({"message": "Review saved"}), 200
    except Exception as e:
        app.logger.exception('Unhandled request error')
        return jsonify({"error": "Internal server error"}), 500

@app.route("/validate-subjects", methods=["POST"])
@auth_required
@rate_limit(20, 60 * 60)
def validate_subjects():
    try:
        data = request.get_json(silent=True) or {}
        subjects = data.get("subjects", [])
        
        if not subjects:
            return jsonify({"valid": True, "invalidItems": []}), 200
        
        validation_error = academic_items_error(subjects)
        if validation_error:
            return jsonify({
                "valid": False,
                "invalidItems": [{"name": "input", "suggestion": validation_error}]
            }), 200

        all_items = []
        for s in subjects:
            name = s.get("name", "").strip()
            if name:
                all_items.append(name)
            for t in s.get("topics", []):
                tname = t.get("name", "").strip()
                if tname:
                    all_items.append(tname)
        
        if not all_items:
            return jsonify({"valid": True, "invalidItems": []}), 200

        # Local validation above remains authoritative when AI is unavailable.
        if not GEMINI_API_KEY:
            return jsonify({"valid": True, "invalidItems": [], "source": "local"}), 200
        
        validation_prompt = f"""You are an academic content validator. Check if each of the following items is a real, legitimate academic subject, topic, or concept that exists in educational curricula anywhere in the world.

Items: {json.dumps(all_items)}

Rules:
- VALID examples: Real academic subjects (Physics, Mathematics, History, Biology), real topics (Thermodynamics, Calculus, Photosynthesis, Organic Chemistry), programming languages (Python, C++, Java), technical terms (SQL, API, Machine Learning, Data Structures), or any real-world educational concept in ANY language.
- INVALID examples: Random character sequences (jdfhd, dsja, ebf, xyzqw), gibberish words that don't correspond to any known academic concept, meaningless strings, keyboard smashes.
- Be LENIENT with abbreviations (DSA, OS, DBMS, NLP, AI, ML, CN, SE, OOP, etc.) — these are VALID.
- Be LENIENT with subjects from any country, language, or educational system if they are real concepts.
- Single common words that could be topics are VALID (e.g., "Algebra", "Gravity", "Evolution").

Return STRICTLY a raw JSON object (no markdown code blocks, no ```json wrapper):
{{"results": [{{"name": "item_name", "valid": true}}, {{"name": "item_name", "valid": false, "suggestion": "Did you mean X?"}}]}}"""

        import time
        models = ['gemini-2.0-flash-lite', 'gemini-2.0-flash', 'gemini-2.5-flash-lite']
        for model_name in models:
            try:
                model = genai.GenerativeModel(model_name)
                response = model.generate_content(validation_prompt)
                response_text = response.text.strip()
                
                if response_text.startswith("```json"):
                    response_text = response_text[7:]
                if response_text.startswith("```"):
                    response_text = response_text[3:]
                if response_text.endswith("```"):
                    response_text = response_text[:-3]
                
                result = json.loads(response_text.strip())
                invalid_items = [r for r in result.get("results", []) if not r.get("valid", True)]
                
                return jsonify({
                    "valid": len(invalid_items) == 0,
                    "invalidItems": invalid_items
                }), 200
            except Exception as e:
                error_str = str(e).lower()
                if "429" in error_str or "quota" in error_str or "rate" in error_str:
                    time.sleep(1)
                    continue
                else:
                    print(f"Validation model {model_name} error: {e}")
                    continue
        
        print("VALIDATION: All models exhausted; local validation was applied")
        return jsonify({"valid": True, "invalidItems": [], "source": "local"}), 200
        
    except Exception as e:
        print(f"VALIDATE SUBJECTS ERROR: {e}")
        return jsonify({"valid": False, "invalidItems": [{"name": "input", "suggestion": "Unable to validate these subjects right now. Please retry."}]}), 503

@app.route("/generate-quiz", methods=["POST"])
@auth_required
@rate_limit(20, 60 * 60)
def generate_quiz():
    data = request.get_json(silent=True) or {}
    subjects = data.get("subjects", [])
    email = g.user_email

    try:
        validate_sleep_hours(data.get("sleepHours"))
    except ValueError as validation_error:
        return jsonify({'error': str(validation_error)}), 400

    if not isinstance(subjects, list) or not 1 <= len(subjects) <= 50:
        return jsonify({'error': 'subjects must contain 1 to 50 topics'}), 400
    if any(not isinstance(topic, str) or not 1 <= len(topic.strip()) <= 300 for topic in subjects):
        return jsonify({'error': 'each quiz topic must be a non-empty string of at most 300 characters'}), 400
    subjects = [topic.strip() for topic in subjects]

    if not subjects:
        return jsonify({"error": "No subjects provided"}), 400

    for topic in subjects:
        validation_error = academic_text_error(topic, 'Quiz topic')
        if validation_error:
            return jsonify({'error': validation_error}), 400
    
    education_level = "General"
    weaknesses = []
    
    if email:
        try:
            conn = get_db()
            student = conn.execute("SELECT student_id, education_level FROM students WHERE lower(email)=?", (email,)).fetchone()
            if student:
                sid = student["student_id"]
                if student["education_level"] and student["education_level"].strip():
                    education_level = student["education_level"].strip()
                
                weakness_rows = conn.execute("SELECT topic_name FROM review_queue WHERE student_id=? ORDER BY id DESC LIMIT 5", (sid,)).fetchall()
                weaknesses = [w["topic_name"] for w in weakness_rows]
            conn.close()
        except Exception as db_err:
            print(f"DATABASE QUIZ CONTEXT ERROR: {db_err}")

    weakness_context = ""
    if weaknesses:
        weakness_context = f"- Recent Weaknesses: {', '.join(weaknesses)} (If any of these topics/concepts overlap with today's topics: {', '.join(subjects)}, try to prioritize generating 1-2 questions testing those specific conceptual gaps)."
        
    prompt = f"""
    You are an expert AI tutor. Your task is to generate a quiz STRICTLY and ONLY based on the specific topics provided below.

    CRITICAL VALIDATION STEP (DO THIS FIRST):
    Examine these topics carefully: {', '.join(subjects)}
    - If ALL or MOST of these topics are gibberish, random characters, meaningless strings, or words that do NOT correspond to any real academic subject/concept in any educational curriculum worldwide, you MUST return EXACTLY this JSON array:
    [{{"error": "invalid_topics", "message": "The provided topics do not appear to be real academic subjects or concepts. Please go back and add valid subjects and topics to generate a meaningful quiz."}}]
    - Examples of INVALID topics: "jdfhd", "dsja", "xyzqw", "ebf", "sdjadd" — these are keyboard gibberish.
    - Examples of VALID topics: "Physics", "Thermodynamics", "Data Structures", "SQL", "Organic Chemistry", "World War II", "Calculus", "Machine Learning".
    - If topics ARE valid real academic concepts, proceed to generate the quiz below.

    QUIZ GENERATION RULES:
    - Generate 7 to 10 multiple-choice questions STRICTLY about these specific topics: {', '.join(subjects)}
    - Every single question MUST directly relate to one of the provided topics. Do NOT generate questions about other subjects, even if they are related to the student's education level.
    - Do NOT use the student's education level to invent questions about subjects NOT in the topics list.
    - The education level below should ONLY be used to calibrate the DIFFICULTY and DEPTH of questions about the provided topics.
    
    Student profile context (for difficulty calibration ONLY, NOT for choosing question topics):
    - Target Goal / Education Level: {education_level}
    {weakness_context}
    
    Return the result STRICTLY as a valid JSON array of objects. Do not wrap in Markdown blocks (like ```json), just return the raw JSON array.
    Each object must have these keys:
    - "question": The question text.
    - "options": An array of exactly 4 strings.
    - "correctAnswer": The exact string from the options array that is the correct answer.
    - "topic": The specific subject/topic this question relates to (MUST be from the provided topics list above).
    - "explanation" (OPTIONAL): A string containing a 1-2 sentence "AI Tutor Note" explanation.
    """
    
    # Test requests must be deterministic and must never consume a student's
    # Gemini quota.  A real provider probe lives in test_models.py and is
    # deliberately opt-in instead.
    if not GEMINI_API_KEY or app.config.get('TESTING'):
        fallback = generate_academic_fallback_quiz(subjects, education_level)
        return jsonify(fallback), 200

    import time
    models_to_try = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-2.0-flash-lite']
    last_error = None
    
    for model_name in models_to_try:
        try:
            model = genai.GenerativeModel(model_name)
            response = model.generate_content(prompt)
            response_text = response.text.strip()
            if response_text.startswith("```json"):
                response_text = response_text[7:]
            if response_text.startswith("```"):
                response_text = response_text[3:]
            if response_text.endswith("```"):
                response_text = response_text[:-3]
                
            quiz_data = json.loads(response_text.strip())
            
            if isinstance(quiz_data, list) and len(quiz_data) > 0 and isinstance(quiz_data[0], dict) and quiz_data[0].get("error") == "invalid_topics":
                return jsonify({
                    "error": quiz_data[0].get("message", "The provided topics are not valid academic subjects. Please add real subjects and topics."),
                    "isValidationError": True
                }), 400

            validation_error = validate_quiz_payload(quiz_data, subjects)
            if validation_error:
                last_error = validation_error
                continue
            
            return jsonify(quiz_data), 200
        except Exception as e:
            last_error = str(e)
            error_str = str(e).lower()
            if "429" in error_str or "quota" in error_str or "rate" in error_str:
                time.sleep(1)
                continue
            else:
                print(f"Quiz Generation Error ({model_name}):", e)
                break
    
    # Resilient fallback: If API quota is exhausted, never block the student
    print("AI Quota exhausted: Using resilient academic fallback quiz")
    fallback = generate_academic_fallback_quiz(subjects, education_level)
    return jsonify(fallback), 200

@app.route("/submit-quiz", methods=["POST"])
@auth_required
def submit_quiz():
    data = request.get_json(silent=True) or {}
    email = data.get("email")
    try:
        score = int(data.get("score", 0))
        total = int(data.get("total", score))
        if score < 0 or total < 1 or score > total:
            raise ValueError('Quiz score is invalid')
    except (TypeError, ValueError) as validation_error:
        return jsonify({'error': str(validation_error)}), 400
    failed_topics = data.get("failedTopics", [])
    if not isinstance(failed_topics, list) or len(failed_topics) > 50:
        return jsonify({'error': 'failedTopics must contain at most 50 items'}), 400
    cleaned_failed_topics = []
    for topic in failed_topics:
        validation_error = academic_text_error(topic, 'Failed quiz topic')
        if validation_error:
            return jsonify({'error': validation_error}), 400
        normalized_topic = topic.strip()
        if normalized_topic.casefold() not in {item.casefold() for item in cleaned_failed_topics}:
            cleaned_failed_topics.append(normalized_topic)
    
    if not email:
        return jsonify({"error": "Email is required"}), 400
        
    try:
        conn = get_db()
        student = conn.execute("SELECT student_id FROM students WHERE lower(email)=?", (email.strip().lower(),)).fetchone()
        if not student:
            conn.close()
            return jsonify({"error": "Student not found"}), 404
            
        sid = student["student_id"]
        
        bonus_xp = score * 10
        if bonus_xp > 0:
            stats = conn.execute("SELECT xp, level, badges FROM user_stats WHERE student_id=?", (sid,)).fetchone()
            if stats:
                new_xp = stats["xp"] + bonus_xp
                new_level = (new_xp // 500) + 1
                conn.execute("UPDATE user_stats SET xp=?, level=? WHERE student_id=?", (new_xp, new_level, sid))
            else:
                new_level = (bonus_xp // 500) + 1
                conn.execute("INSERT INTO user_stats (student_id, xp, level, badges) VALUES (?, ?, ?, ?)", (sid, bonus_xp, new_level, "[]"))
                
        from datetime import datetime, timedelta
        tomorrow = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
        
        for topic in cleaned_failed_topics:
            conn.execute("""
                INSERT INTO review_queue (student_id, topic_name, next_review_date, interval, ease_factor)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(student_id, topic_name) DO UPDATE SET
                    next_review_date = ?,
                    interval = ?,
                    ease_factor = ?
            """, (sid, topic, tomorrow, 1, 1.3, tomorrow, 1, 1.3))
            
        conn.commit()
        conn.close()
        return jsonify({"message": "Quiz submitted successfully"}), 200
    except Exception as e:
        print("Submit Quiz Error:", e)
        app.logger.exception('Unhandled request error')
        return jsonify({"error": "Internal server error"}), 500

create_tables()

if __name__ == "__main__":
    app.run(
        debug=os.environ.get('PLANIFY_DEBUG', '').lower() == 'true',
        host=os.environ.get('PLANIFY_HOST', '127.0.0.1'),
        port=int(os.environ.get('PORT', '5000')),
    )
