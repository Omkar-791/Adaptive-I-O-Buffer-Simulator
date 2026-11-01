"""Bounded Windows sharing-violation recovery for atomic derived-file replacement."""
import os
import time


def atomic_replace(source, target):
    # Virus scanners/indexers can temporarily retain a destination handle on Windows.
    # Retry only the relevant Windows errors; preserve old+staged files on exhaustion.
    for attempt in range(6):
        try:
            os.replace(source, target)
            return
        except PermissionError as error:
            if getattr(error, 'winerror', None) not in (5, 32, 33) or attempt == 5:
                raise
            time.sleep(0.01 * 2**attempt)
