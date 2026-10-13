"""
Automatic schema migration helper for SQLite database.
Ensures new columns added to SQLAlchemy models are safely added to existing SQLite tables.
"""
import sqlite3
import os
from .database import DB_PATH
from . import models

def auto_migrate_db():
    if not os.path.exists(DB_PATH):
        return
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
    existing_tables = {row[0] for row in cursor.fetchall()}
    
    for table_name, table in models.Base.metadata.tables.items():
        if table_name in existing_tables:
            cursor.execute(f"PRAGMA table_info({table_name})")
            existing_cols = {row[1] for row in cursor.fetchall()}
            for column in table.columns:
                if column.name not in existing_cols:
                    col_type = str(column.type).upper()
                    if "VARCHAR" in col_type or "TEXT" in col_type or "STRING" in col_type:
                        sql_type = "TEXT"
                    elif "INTEGER" in col_type or "BOOLEAN" in col_type or "INT" in col_type:
                        sql_type = "INTEGER"
                    elif "FLOAT" in col_type or "NUMERIC" in col_type or "REAL" in col_type:
                        sql_type = "REAL"
                    elif "DATETIME" in col_type:
                        sql_type = "TIMESTAMP"
                    else:
                        sql_type = "TEXT"
                    
                    alter_sql = f"ALTER TABLE {table_name} ADD COLUMN {column.name} {sql_type}"
                    try:
                        cursor.execute(alter_sql)
                    except Exception as e:
                        print(f"Migration note ({table_name}.{column.name}): {e}")
    
    conn.commit()
    conn.close()
