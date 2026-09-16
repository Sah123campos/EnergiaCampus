import os


basedir = os.path.abspath(os.path.dirname(__file__))


def _mysql_uri():
    host = os.getenv('MYSQL_HOST', 'localhost')
    port = os.getenv('MYSQL_PORT', '3306')
    user = os.getenv('MYSQL_USER', 'root')
    password = os.getenv('MYSQL_PASSWORD', '')
    database = os.getenv('MYSQL_DATABASE', 'energiacampus')
    return f'mysql+pymysql://{user}:{password}@{host}:{port}/{database}?charset=utf8mb4'


class Config:
    SECRET_KEY = os.getenv('SECRET_KEY', 'energiacampus-secret-key')
    SQLALCHEMY_DATABASE_URI = os.getenv('DATABASE_URL', _mysql_uri())
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    JSON_SORT_KEYS = False
