export const QUESTION = "Why are accounts churning?";
export const SAMPLE_CSV = `account_id,name,plan,seats,mrr,logins_30d,last_active_days,status
acct-001,Northwind Logistics,pro,25,1250,2,47,churned
acct-002,Bluebird Health,team,8,400,18,3,active
acct-003,Cedar & Pine Legal,pro,12,600,1,62,churned
acct-004,Dynamo Robotics,enterprise,120,9600,40,1,active
acct-005,Evergreen Foods,team,6,300,3,35,at_risk
acct-006,Fathom Analytics,pro,15,750,22,2,active
acct-007,Grove Studios,team,4,200,0,71,churned
acct-008,Harbor Freight Co-op,pro,30,1500,4,28,at_risk
acct-009,Ionic Labs,enterprise,60,4800,31,1,active
acct-010,Juniper Retail,team,9,450,2,52,churned
acct-011,Keystone Builders,pro,18,900,11,9,active
acct-012,Lumen Education,team,5,250,1,44,at_risk
`;
export const SAMPLE_TICKETS = `[acct-001] Our admin who championed the tool left the company in March and nobody else knows how to configure it. The new manager wants to cut tools.

[acct-003] The invoice jumped after the seat true-up and it feels too expensive for how little we use it. We are comparing a cheaper alternative.

[acct-005] Setup was confusing, the docs did not explain the integration and we never finished onboarding. Still waiting on a reply from support after 6 days.

[acct-007] We could not export reports to CSV, a missing feature that blocks our monthly review. Workaround is manual copying.

[acct-008] The dashboard is very slow and we hit an error when loading large reports. Several outages this quarter.

[acct-010] Billing: price per seat is too high for a small team, asked for a discount and got no answer.

[acct-012] Getting started training never happened, my team is confused about where to begin.

[acct-002] Love the product, quick question about SSO settings. Support was fast last time.

[acct-004] Feature request: API endpoint for bulk user provisioning. Otherwise happy.

[acct-006] Minor bug on the settings page, support fixed it within a day.

[acct-001] Escalation ignored for two weeks, the support response time was unacceptable.

[acct-009] Planning a reorg next quarter; the new owner of the project will need an intro call.`;
export const SAMPLE_CALLS = `[acct-003] Call notes: Main user stopped logging in, said the team is busy and the tool did not fit their workflow. Budget review coming up and cost is the main concern.

[acct-010] Call notes: Champion was laid off, remaining staff rarely use the product. Considering a cheaper tool.`;
