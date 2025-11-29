import sqlite3
import csv
import os
import sys

# Increase CSV field size limit
csv.field_size_limit(sys.maxsize)

# Config
SNOMED_DESC_PATH = "public/uk_sct2cl_41.2.0_20251119000001Z/SnomedCT_InternationalRF2_PRODUCTION_20250801T120000Z/Snapshot/Terminology/sct2_Description_Snapshot-en_INT_20250801.txt"
DB_OUTPUT_PATH = "assets/snomed.db"

def convert_to_sqlite():
    if not os.path.exists(SNOMED_DESC_PATH):
        print(f"Error: Source file not found at {SNOMED_DESC_PATH}")
        return

    print(f"Creating SQLite DB at {DB_OUTPUT_PATH}...")
    
    # Remove existing DB if any
    if os.path.exists(DB_OUTPUT_PATH):
        os.remove(DB_OUTPUT_PATH)

    conn = sqlite3.connect(DB_OUTPUT_PATH)
    cursor = conn.cursor()

    # Create table
    # id	effectiveTime	active	moduleId	conceptId	languageCode	typeId	term	caseSignificanceId
    cursor.execute('''
        CREATE TABLE descriptions (
            id TEXT PRIMARY KEY,
            conceptId TEXT,
            term TEXT,
            active INTEGER
        )
    ''')
    
    # Create index for faster search
    cursor.execute('CREATE INDEX idx_term ON descriptions(term)')
    cursor.execute('CREATE INDEX idx_concept ON descriptions(conceptId)')

    print("Reading SNOMED file...")
    
    count = 0
    batch = []
    BATCH_SIZE = 10000

    with open(SNOMED_DESC_PATH, 'r', encoding='utf-8') as f:
        reader = csv.reader(f, delimiter='\t')
        next(reader) # Skip header

        for row in reader:
            # row[0]=id, row[2]=active, row[4]=conceptId, row[7]=term
            # Only import active concepts (active=1)
            if row[2] == '1':
                batch.append((row[0], row[4], row[7], 1))
                count += 1
            
            if len(batch) >= BATCH_SIZE:
                cursor.executemany('INSERT INTO descriptions (id, conceptId, term, active) VALUES (?, ?, ?, ?)', batch)
                batch = []
                if count % 100000 == 0:
                    print(f"Processed {count} rows...")

        # Insert remaining
        if batch:
            cursor.executemany('INSERT INTO descriptions (id, conceptId, term, active) VALUES (?, ?, ?, ?)', batch)

    conn.commit()
    conn.close()
    print(f"Done! Imported {count} active descriptions to {DB_OUTPUT_PATH}")

if __name__ == "__main__":
    convert_to_sqlite()
