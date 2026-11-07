db = db.getSiblingDB('verto');

db.createCollection('request_payloads', {
  validationLevel: 'strict',
  validationAction: 'error',
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['request_id', 'project_id', 'type', 'markdown_raw', 'rich_text', 'fields', 'created_at'],
      properties: {
        request_id: { bsonType: 'string' },
        project_id: { bsonType: 'string' },
        type: { enum: ['FEATURE', 'BUG', 'UI_UX', 'CONTENT', 'TECHNICAL'] },
        markdown_raw: { bsonType: 'string', minLength: 10 },
        rich_text: { bsonType: 'object' },
        fields: { bsonType: 'object' },
        created_at: { bsonType: 'date' },
      },
      oneOf: [
        {
          properties: {
            type: { enum: ['BUG'] },
            fields: {
              bsonType: 'object',
              required: ['steps_to_reproduce', 'severity', 'regression_of_delivered', 'environment'],
              properties: {
                steps_to_reproduce: { bsonType: 'array', minItems: 1, items: { bsonType: 'string' } },
                severity: { enum: ['MINOR', 'MAJOR', 'CRITICAL'] },
                regression_of_delivered: { bsonType: 'bool' },
                environment: {
                  bsonType: 'object',
                  required: ['browser', 'os'],
                  properties: {
                    browser: { bsonType: 'string' },
                    os: { bsonType: 'string' },
                    viewport: { bsonType: 'string' },
                  },
                },
              },
            },
          },
        },
        {
          properties: {
            type: { enum: ['FEATURE'] },
            fields: {
              bsonType: 'object',
              required: ['acceptance_criteria'],
              properties: {
                acceptance_criteria: { bsonType: 'array', minItems: 1, items: { bsonType: 'string' } },
                affected_areas: { bsonType: 'array', items: { bsonType: 'string' } },
              },
            },
          },
        },
        {
          properties: {
            type: { enum: ['UI_UX'] },
            fields: {
              bsonType: 'object',
              required: ['screens'],
              properties: {
                screens: { bsonType: 'array', minItems: 1, items: { bsonType: 'string' } },
                design_link: { bsonType: 'string' },
              },
            },
          },
        },
        {
          properties: {
            type: { enum: ['CONTENT'] },
            fields: {
              bsonType: 'object',
              required: ['pages'],
              properties: {
                pages: { bsonType: 'array', minItems: 1, items: { bsonType: 'string' } },
                word_count: { bsonType: 'number', minimum: 0 },
              },
            },
          },
        },
        {
          properties: {
            type: { enum: ['TECHNICAL'] },
            fields: {
              bsonType: 'object',
              required: ['component', 'change_kind'],
              properties: {
                component: { bsonType: 'string' },
                change_kind: { enum: ['REFACTOR', 'UPGRADE', 'CONFIG', 'INFRA'] },
              },
            },
          },
        },
      ],
    },
  },
});

db.request_payloads.createIndex({ request_id: 1 }, { unique: true });
db.request_payloads.createIndex({ project_id: 1, type: 1 });
db.request_payloads.createIndex({ 'fields.severity': 1 });