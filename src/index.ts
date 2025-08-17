import { Hono } from 'hono';
import { cors } from 'hono/cors';

// Firestore REST API utilities
interface FirestoreData {
  [key: string]: any;
}

interface FirestoreDocument {
  name: string;
  fields: {
    [key: string]: {
      stringValue?: string;
      integerValue?: string;
      doubleValue?: number;
      booleanValue?: boolean;
      timestampValue?: string;
    };
  };
  createTime: string;
  updateTime: string;
}

class FirestoreClient {
  private projectId: string;
  private accessToken: string | null = null;

  constructor(projectId: string) {
    this.projectId = projectId;
  }

  async getAccessToken(clientEmail: string, privateKey: string): Promise<string> {
    if (this.accessToken) return this.accessToken;

    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: clientEmail,
      scope: 'https://www.googleapis.com/auth/datastore',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    };

    const header = { alg: 'RS256', typ: 'JWT' };
    const encodedHeader = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const encodedPayload = btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    
    const signatureInput = `${encodedHeader}.${encodedPayload}`;
    
    // Import private key
    const keyData = privateKey.replace(/\\n/g, '\n');
    const key = await crypto.subtle.importKey(
      'pkcs8',
      new TextEncoder().encode(keyData),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      key,
      new TextEncoder().encode(signatureInput)
    );

    const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)))
      .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

    const jwt = `${signatureInput}.${encodedSignature}`;

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    });

    const result = await response.json() as any;
    this.accessToken = result.access_token;
    return this.accessToken;
  }

  async addDocument(collection: string, data: FirestoreData, token: string): Promise<any> {
    const fields: any = {};
    
    // Convert data to Firestore format
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'string') {
        fields[key] = { stringValue: value };
      } else if (typeof value === 'number') {
        fields[key] = Number.isInteger(value) ? { integerValue: value.toString() } : { doubleValue: value };
      } else if (typeof value === 'boolean') {
        fields[key] = { booleanValue: value };
      } else {
        fields[key] = { stringValue: JSON.stringify(value) };
      }
    }

    // Add timestamp
    fields.timestamp = { timestampValue: new Date().toISOString() };

    const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/${collection}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields })
    });

    return response.json();
  }

  async getDocuments(collection: string, token: string): Promise<any[]> {
    const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/${collection}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    const result = await response.json() as any;
    
    if (!result.documents) return [];

    return result.documents.map((doc: FirestoreDocument) => {
      const data: any = { id: doc.name.split('/').pop() };
      
      for (const [key, value] of Object.entries(doc.fields)) {
        if (value.stringValue !== undefined) {
          data[key] = value.stringValue;
        } else if (value.integerValue !== undefined) {
          data[key] = parseInt(value.integerValue);
        } else if (value.doubleValue !== undefined) {
          data[key] = value.doubleValue;
        } else if (value.booleanValue !== undefined) {
          data[key] = value.booleanValue;
        } else if (value.timestampValue !== undefined) {
          data[key] = value.timestampValue;
        }
      }
      
      return data;
    });
  }
}

// HTML template for home page
const getHomePageHTML = (data: any[]) => `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>عرض البيانات المباشر</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
            color: #333;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: rgba(255, 255, 255, 0.95);
            border-radius: 20px;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
            overflow: hidden;
        }
        
        .header {
            background: linear-gradient(45deg, #4facfe 0%, #00f2fe 100%);
            padding: 30px;
            text-align: center;
            color: white;
        }
        
        .header h1 {
            font-size: 2.5em;
            margin-bottom: 10px;
            text-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }
        
        .status {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            margin-top: 15px;
        }
        
        .status-dot {
            width: 12px;
            height: 12px;
            background: #00ff88;
            border-radius: 50%;
            animation: pulse 2s infinite;
        }
        
        @keyframes pulse {
            0% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.5; transform: scale(1.2); }
            100% { opacity: 1; transform: scale(1); }
        }
        
        .content {
            padding: 30px;
        }
        
        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        
        .stat-card {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 25px;
            border-radius: 15px;
            text-align: center;
            box-shadow: 0 10px 20px rgba(0,0,0,0.1);
            transform: translateY(0);
            transition: transform 0.3s ease;
        }
        
        .stat-card:hover {
            transform: translateY(-5px);
        }
        
        .stat-number {
            font-size: 3em;
            font-weight: bold;
            margin-bottom: 10px;
        }
        
        .data-grid {
            display: grid;
            gap: 20px;
            grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
        }
        
        .data-card {
            background: white;
            border-radius: 15px;
            padding: 25px;
            box-shadow: 0 8px 25px rgba(0,0,0,0.1);
            border: 1px solid #e0e0e0;
            position: relative;
            overflow: hidden;
            transition: transform 0.3s ease, box-shadow 0.3s ease;
        }
        
        .data-card:hover {
            transform: translateY(-5px);
            box-shadow: 0 15px 35px rgba(0,0,0,0.15);
        }
        
        .data-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 4px;
            background: linear-gradient(45deg, #4facfe 0%, #00f2fe 100%);
        }
        
        .data-item {
            margin-bottom: 15px;
        }
        
        .data-label {
            font-weight: bold;
            color: #555;
            margin-bottom: 5px;
            font-size: 0.9em;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        
        .data-value {
            background: #f8f9fa;
            padding: 12px;
            border-radius: 8px;
            border-right: 4px solid #4facfe;
            word-break: break-word;
            font-size: 1.1em;
        }
        
        .timestamp {
            color: #666;
            font-size: 0.9em;
            text-align: center;
            margin-top: 15px;
            padding-top: 15px;
            border-top: 1px solid #eee;
        }
        
        .no-data {
            text-align: center;
            padding: 60px 20px;
            color: #666;
        }
        
        .no-data-icon {
            font-size: 4em;
            margin-bottom: 20px;
            opacity: 0.3;
        }
        
        .refresh-info {
            text-align: center;
            margin-top: 20px;
            padding: 15px;
            background: #e8f4fd;
            border-radius: 10px;
            color: #0066cc;
            font-size: 0.9em;
        }
        
        @media (max-width: 768px) {
            .container {
                margin: 10px;
                border-radius: 15px;
            }
            
            .header h1 {
                font-size: 2em;
            }
            
            .data-grid {
                grid-template-columns: 1fr;
            }
            
            .stats {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚀 عرض البيانات المباشر</h1>
            <div class="status">
                <div class="status-dot"></div>
                <span>متصل ومحدث لحظياً</span>
            </div>
        </div>
        
        <div class="content">
            <div class="stats">
                <div class="stat-card">
                    <div class="stat-number">${data.length}</div>
                    <div>إجمالي السجلات</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number">${data.length > 0 ? new Date().toLocaleDateString('ar-EG') : '0'}</div>
                    <div>آخر تحديث</div>
                </div>
            </div>
            
            ${data.length > 0 ? `
                <div class="data-grid">
                    ${data.map((item, index) => `
                        <div class="data-card">
                            <h3 style="color: #4facfe; margin-bottom: 20px; font-size: 1.3em;">📄 السجل #${index + 1}</h3>
                            ${Object.entries(item).filter(([key]) => key !== 'id' && key !== 'timestamp').map(([key, value]) => `
                                <div class="data-item">
                                    <div class="data-label">${key}</div>
                                    <div class="data-value">${typeof value === 'object' ? JSON.stringify(value, null, 2) : value}</div>
                                </div>
                            `).join('')}
                            ${item.timestamp ? `
                                <div class="timestamp">
                                    ⏰ ${new Date(item.timestamp).toLocaleString('ar-EG')}
                                </div>
                            ` : ''}
                        </div>
                    `).join('')}
                </div>
            ` : `
                <div class="no-data">
                    <div class="no-data-icon">📭</div>
                    <h2>لا توجد بيانات حتى الآن</h2>
                    <p>قم بإرسال البيانات إلى <code>/receive</code> لتظهر هنا</p>
                </div>
            `}
            
            <div class="refresh-info">
                💡 الصفحة تحدث تلقائياً كل 5 ثوانٍ لعرض آخر البيانات
            </div>
        </div>
    </div>
    
    <script>
        // Auto refresh every 5 seconds
        setInterval(() => {
            window.location.reload();
        }, 5000);
        
        // Add smooth entrance animation
        document.addEventListener('DOMContentLoaded', () => {
            const cards = document.querySelectorAll('.data-card');
            cards.forEach((card, index) => {
                card.style.opacity = '0';
                card.style.transform = 'translateY(20px)';
                setTimeout(() => {
                    card.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
                    card.style.opacity = '1';
                    card.style.transform = 'translateY(0)';
                }, index * 100);
            });
        });
    </script>
</body>
</html>
`;

// Initialize Hono app
const app = new Hono();

// Enable CORS
app.use('*', cors());

// Environment interface
interface Env {
  FIREBASE_PROJECT_ID: string;
  FIREBASE_CLIENT_EMAIL: string;
  FIREBASE_PRIVATE_KEY: string;
}

// Initialize Firestore client
let firestoreClient: FirestoreClient;

// Middleware to initialize Firestore
app.use('*', async (c, next) => {
  const env = c.env as Env;
  if (!firestoreClient) {
    firestoreClient = new FirestoreClient(env.FIREBASE_PROJECT_ID);
  }
  await next();
});

// Home route - Display data from Firestore
app.get('/home', async (c) => {
  try {
    const env = c.env as Env;
    const token = await firestoreClient.getAccessToken(env.FIREBASE_CLIENT_EMAIL, env.FIREBASE_PRIVATE_KEY);
    const data = await firestoreClient.getDocuments('received_data', token);
    
    // Sort by timestamp descending (newest first)
    data.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    return c.html(getHomePageHTML(data));
  } catch (error) {
    console.error('Error fetching data:', error);
    return c.html(getHomePageHTML([]));
  }
});

// Receive route - Store JSON data in Firestore
app.post('/receive', async (c) => {
  try {
    const env = c.env as Env;
    const jsonData = await c.req.json();
    
    const token = await firestoreClient.getAccessToken(env.FIREBASE_CLIENT_EMAIL, env.FIREBASE_PRIVATE_KEY);
    const result = await firestoreClient.addDocument('received_data', jsonData, token);
    
    return c.json({ 
      success: true, 
      message: 'تم حفظ البيانات بنجاح',
      documentId: result.name?.split('/').pop(),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error saving data:', error);
    return c.json({ 
      success: false, 
      message: 'خطأ في حفظ البيانات',
      error: error.message 
    }, 500);
  }
});

// Root route
app.get('/', (c) => {
  return c.json({ 
    message: 'مرحباً! الخادم يعمل بنجاح',
    endpoints: {
      home: '/home - عرض البيانات',
      receive: '/receive - استقبال البيانات (POST)'
    }
  });
});

// API route to get data as JSON
app.get('/api/data', async (c) => {
  try {
    const env = c.env as Env;
    const token = await firestoreClient.getAccessToken(env.FIREBASE_CLIENT_EMAIL, env.FIREBASE_PRIVATE_KEY);
    const data = await firestoreClient.getDocuments('received_data', token);
    
    // Sort by timestamp descending
    data.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    return c.json({
      success: true,
      data: data,
      total: data.length,
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching data:', error);
    return c.json({ 
      success: false, 
      message: 'خطأ في جلب البيانات',
      error: error.message 
    }, 500);
  }
});

export default app;