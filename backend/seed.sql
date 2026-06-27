-- Default Company
INSERT INTO companies (id, name, code, description) 
VALUES ('11111111-0000-0000-0000-000000000000', 'Nxt People Corp', 'NXT', 'Main company')
ON CONFLICT DO NOTHING;

-- Default Settings
INSERT INTO settings (company_name, company_email, work_start_time, work_end_time) 
VALUES ('Nxt People Corp', 'hr@nxtpeople.com', '09:00', '18:00');

-- Default Shifts
INSERT INTO shifts (id, name, start_time, end_time, is_default, color) 
VALUES ('22222222-0000-0000-0000-000000000000', 'General Shift', '09:00', '18:00', true, '#4F46E5')
ON CONFLICT DO NOTHING;

-- Default Users (Password is 'password123' hashed with bcrypt)
INSERT INTO employees (id, first_name, last_name, email, password, role, department, designation, employee_id, company, division, shift_id, has_accepted) 
VALUES
('33333333-0000-0000-0000-000000000001', 'Admin', 'User', 'balaji@altiusnxt.com', '$2a$12$YCpeBnyT89EDfz.F6i936.nYbAdIp0M3Wc8E9nifiuNj/AIWQKeHi', 'admin', 'HR', 'HR Director', 'NXT1001', 'Nxt People Corp', 'HR', '22222222-0000-0000-0000-000000000000', true),
('33333333-0000-0000-0000-000000000002', 'Sarah', 'Johnson', 'sanjana@altiusnxt.com', '$2a$12$YCpeBnyT89EDfz.F6i936.nYbAdIp0M3Wc8E9nifiuNj/AIWQKeHi', 'manager', 'Engineering', 'Engineering Manager', 'NXT1002', 'Nxt People Corp', 'Engineering', '22222222-0000-0000-0000-000000000000', true),
('33333333-0000-0000-0000-000000000003', 'Michael', 'Chen', 'saranya@altiusnxt.com', '$2a$12$YCpeBnyT89EDfz.F6i936.nYbAdIp0M3Wc8E9nifiuNj/AIWQKeHi', 'employee', 'Engineering', 'Senior Developer', 'NXT1003', 'Nxt People Corp', 'Engineering', '22222222-0000-0000-0000-000000000000', true)
ON CONFLICT DO NOTHING;

-- Default Holidays
INSERT INTO holidays (name, date, type, year) 
VALUES
('New Year', '2024-01-01', 'national', 2024),
('Company Foundation Day', '2024-06-15', 'company', 2024);
