import importlib
import os
import unittest


class TestMysqlConfig(unittest.TestCase):
    def test_database_url_uses_mysql_when_defined(self):
        os.environ['DATABASE_URL'] = 'mysql+pymysql://sensor:s3nh@localhost:3306/energiacampus'
        import config
        importlib.reload(config)

        self.assertIn('mysql+pymysql://', config.Config.SQLALCHEMY_DATABASE_URI)
        self.assertIn('energiacampus', config.Config.SQLALCHEMY_DATABASE_URI)

    def test_database_url_defaults_to_sqlite_for_local_development(self):
        os.environ.pop('DATABASE_URL', None)
        import config
        importlib.reload(config)

        self.assertIn('sqlite:///', config.Config.SQLALCHEMY_DATABASE_URI)
        self.assertIn('energiacampus.db', config.Config.SQLALCHEMY_DATABASE_URI)


if __name__ == '__main__':
    unittest.main()
