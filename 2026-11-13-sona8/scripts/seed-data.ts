export const DEMO_TITLE = "Sales quote creation — EMEA";
export const DEMO_TOPIC = "How does a sales quote get created, from customer request to sent offer?";

type Demo = { team: string; site: string; role: string; name: string; answers: string[] };

export const DEMO_PARTICIPANTS: Demo[] = [
  {
    name: "Anna K.", team: "Sales", site: "Vienna", role: "Account Executive",
    answers: [
      "It starts when a customer sends a request for quote by email, usually to my shared inbox.",
      "First I check the customer record in the CRM. Then I create a quote draft in an Excel template.",
      "I copy the product list and prices from the price sheet into Excel by hand, because the CRM does not export the bundles.",
      "After that I send the draft to Sales Ops by email for a discount check.",
      "Sales Ops sends it back, and I update the draft and forward it to my manager for approval.",
      "If the customer is new, I have to ask Finance for a credit check, which is another email and I wait days.",
      "The slowest part is waiting for approvals. I retype the same data twice, once in Excel and once in the CRM.",
      "Finally I export a PDF and send the quote to the customer by email.",
    ],
  },
  {
    name: "Markus B.", team: "Sales Ops", site: "Munich", role: "Pricing Analyst",
    answers: [
      "A quote request arrives when a salesperson emails me the Excel draft for a discount check.",
      "I check the discount against the price rules in SAP and compare it with similar past quotes.",
      "I look up margins manually in a separate Excel file, copy the numbers into the draft and note the result.",
      "Then I send the draft back to the salesperson by email, or forward it to the regional manager if it is above 15 percent.",
      "If the discount is above the limit, the manager approval takes days and nobody tracks the request.",
      "Honestly the pain point is that the price rules live in three different Excel files and they are slow to update.",
      "Sometimes the salesperson changes the draft after I approved it, so I have to review it twice.",
      "I also update the pricing tracker by hand at the end of every week.",
    ],
  },
  {
    name: "Lena S.", team: "Finance", site: "Munich", role: "Credit Controller",
    answers: [
      "I get involved when a salesperson emails me a credit check request for a new customer.",
      "I open the customer in SAP and check the payment history, then look up the credit score in an external portal.",
      "I copy the score into an Excel sheet and write the credit limit by hand, since SAP has no field for the external score.",
      "Then I send the result back to the salesperson by email and update the customer master data.",
      "If the customer has no history, I ask for a bank reference, which delays everything by a week.",
      "The slow part is that requests arrive without the company registration number, so I wait for the answer.",
      "I also approve large quotes over a limit, forwarded to me by the manager, and I enter my approval in SAP manually.",
      "It would be great if the credit check ran automatically when a new customer is created, instead of by email.",
    ],
  },
];
