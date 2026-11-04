import requests
import hashlib
import time

BASE_URL = "http://localhost:5001/api"
STUDENT_EMAIL = "oluwadareanuoluwapo458@gmail.com"
PASSWORD = "password123" # Use a test account password

def test_flow():
    session = requests.Session()

    print("1. Logging in...")
    try:
        login_res = session.post(f"{BASE_URL}/auth/login", json={
            "email": STUDENT_EMAIL,
            "password": PASSWORD
        })

        if login_res.status_code != 200:
            print(f"❌ Login failed: {login_res.text}")
            return
        print("✅ Login successful")
    except Exception as e:
        print(f"❌ Server connection error: {e}")
        return

    print("\n2. Getting ImageKit Auth Signature...")
    auth_res = session.get(f"{BASE_URL}/verifications/auth")
    if auth_res.status_code != 200:
        print(f"❌ Auth Params failed: {auth_res.text}")
        return
    print("✅ Auth params received")

    print("\n3. Simulating Client-Side Submit (Direct URL)...")
    # Simulate a successful direct upload URL
    fake_url = "https://ik.imagekit.io/oluwadaredaniel/manual_approval_placeholder.png"
    fake_hash = f"TEST-HASH-{int(time.time())}"

    submit_res = session.post(f"{BASE_URL}/verifications/submit", json={
        "receiptImage": fake_url,
        "receiptHash": fake_hash
    })

    if submit_res.status_code == 201:
        print("✨ SUCCESS: Receipt submitted via direct URL flow!")
    else:
        print(f"❌ Submission failed ({submit_res.status_code}): {submit_res.text}")

if __name__ == "__main__":
    test_flow()
