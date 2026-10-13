/** DEV FIXTURE ONLY — synthetic Indian names and places for mock patients. */

export const REGIONS = {
  North: ["Jaipur", "Lucknow", "Delhi", "Chandigarh"],
  South: ["Chennai", "Bengaluru", "Kochi", "Hyderabad"],
  West: ["Ahmedabad", "Pune", "Mumbai", "Indore"],
  East: ["Kolkata", "Bhubaneswar", "Patna", "Guwahati"],
} as const;

export type Region = keyof typeof REGIONS;

export const FIRST = {
  F: ["Meera", "Lakshmi", "Anjali", "Kavita", "Sunita", "Priya", "Fatima", "Rekha", "Deepa", "Shalini", "Nandini", "Ritu", "Asha", "Gurpreet"],
  M: ["Rajesh", "Suresh", "Arjun", "Vikram", "Imran", "Mohan", "Anil", "Prakash", "Karthik", "Harpreet", "Sanjay", "Ramesh", "Joseph", "Abhishek"],
} as const;

export const SURNAMES: Record<Region, string[]> = {
  North: ["Sharma", "Verma", "Gupta", "Singh", "Malhotra", "Khan", "Saxena"],
  South: ["Iyer", "Reddy", "Nair", "Krishnan", "Rao", "Menon", "Pillai"],
  West: ["Patel", "Shah", "Joshi", "Deshmukh", "Kulkarni", "Mehta", "Desai"],
  East: ["Das", "Banerjee", "Ghosh", "Mohanty", "Sen", "Bose", "Sinha"],
};
