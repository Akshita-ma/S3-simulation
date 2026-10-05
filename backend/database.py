import os
from typing import Generator
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker, Session

# SQLite database file stored in the backend directory by default
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./smart_vault.db")

# check_same_thread=False is needed only for SQLite to allow multiple threads
# to interact with the same database connection across FastAPI request lifecycles.
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(
    DATABASE_URL,
    connect_args=connect_args,
    echo=os.getenv("SQL_ECHO", "False").lower() in ("true", "1")
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db() -> Generator[Session, None, None]:
    """
    FastAPI dependency that yields a SQLAlchemy database session per request
    and ensures it is properly closed when the request finishes.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
