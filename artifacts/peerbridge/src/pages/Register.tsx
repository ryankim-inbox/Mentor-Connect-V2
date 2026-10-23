import { trimDisplayName } from "@/lib/display-name";
import { countyLabel, districtTypeLabel } from "@/lib/district-display";
import { useRef, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useRegister, useListDistricts } from "@workspace/api-client-react";
import { getGetMeQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth, sessionReturnPath } from "@/lib/auth-context";
import { apiErrorMessage } from "@/lib/api-error-message";
import { dateOfBirthError, signupPasswordError, SIGNUP_PASSWORD_HELP } from "@/lib/signup-validation";

export default function Register() {
  const [, navigate] = useLocation();
  const { refetch } = useAuth();
  const queryClient = useQueryClient();
  const search = useSearch();
  const destination = sessionReturnPath(
    new URLSearchParams(search).get("returnTo"),
  );
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);

  const confirmSession = async () => {
    try {
      const user = await refetch();
      if (user) navigate(user.hasMemberAccess ? destination : "/verify-email");
      else
        setError(
          "Your session isn't active yet. Recheck your session or sign in again.",
        );
    } catch {
      setError(
        "Your account was accepted, but we couldn't verify the session. Please recheck it.",
      );
    }
  };
  const retrySession = async () => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      await confirmSession();
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    gender: "" as "" | "female" | "male",
    dateOfBirth: "",
    role: "mentee" as "mentor" | "mentee" | "both",
    districtId: 0,
  });
  const [error, setError] = useState("");
  const [districtSearch, setDistrictSearch] = useState("");

  const {
    data: districts,
    isPending: districtsPending,
    isError: districtsError,
    isFetching: districtsFetching,
    refetch: retryDistricts,
  } = useListDistricts(
    { search: districtSearch || undefined },
    {
      query: { queryKey: ["listDistricts", districtSearch] },
    },
  );
  const districtsUnavailable = districtsPending || districtsFetching || districtsError;
  const selectedDistrict = districts?.find((district) => district.id === form.districtId);

  const registerMutation = useRegister();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy.current || districtsUnavailable) return;
    setError("");

    const name = trimDisplayName(form.name);
    if (!name || new TextEncoder().encode(form.name).length > 120) {
      setError("Use a name of 1–120 UTF-8 bytes.");
      return;
    }

    const validationError = signupPasswordError(form.password) || dateOfBirthError(form.dateOfBirth);
    if (validationError) {
      setError(validationError);
      return;
    }
    const gender = form.gender;
    if (gender !== "female" && gender !== "male") {
      setError("Please select female or male.");
      return;
    }

    if (!selectedDistrict) {
      setError("Please select your school district");
      return;
    }

    busy.current = true;
    setPending(true);
    setNeedsConfirmation(false);
    try {
      await queryClient.cancelQueries({ queryKey: getGetMeQueryKey() });
      const response = await registerMutation.mutateAsync({
        data: { ...form, name, gender },
      });
      await queryClient.cancelQueries();
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] !== getGetMeQueryKey()[0],
      });
      queryClient.getMutationCache().clear();
      queryClient.setQueryData(getGetMeQueryKey(), response.user);
      setNeedsConfirmation(true);
      await confirmSession();
    } catch (error) {
      setError(apiErrorMessage(error));
    } finally {
      busy.current = false;
      setPending(false);
    }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-foreground">
            Create your account
          </h1>
          <p className="text-muted-foreground mt-1">
            Join PeerBridge with your school email
          </p>
        </div>

        <div className="bg-card border border-card-border rounded-2xl p-8 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-4" aria-busy={pending}>
            <div>
              <label htmlFor="register-name" className="block text-sm font-medium text-foreground mb-1.5">
                Full name
              </label>
              <input
                id="register-name"
                type="text"
                autoComplete="name"
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
                placeholder="Your name"
                required
                className="w-full px-3 py-2.5 border border-input rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition"
              />
            </div>

            <div>
              <label htmlFor="register-email" className="block text-sm font-medium text-foreground mb-1.5">
                School email
              </label>
              <input
                id="register-email"
                type="email"
                autoComplete="username"
                aria-describedby="register-email-help"
                value={form.email}
                onChange={(e) =>
                  setForm((f) => ({ ...f, email: e.target.value }))
                }
                placeholder="you@school.edu"
                required
                className="w-full px-3 py-2.5 border border-input rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition"
              />
              <p id="register-email-help" className="text-xs text-muted-foreground mt-1">
                Use your .edu school email. A non-.edu address is allowed only
                for an approved test account.
              </p>
            </div>

            <div>
              <label htmlFor="register-password" className="block text-sm font-medium text-foreground mb-1.5">
                Password
              </label>
              <input
                id="register-password"
                type="password"
                autoComplete="new-password"
                aria-describedby="register-password-help"
                value={form.password}
                onChange={(e) =>
                  setForm((f) => ({ ...f, password: e.target.value }))
                }
                placeholder="Create a password"
                required
                className="w-full px-3 py-2.5 border border-input rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition"
              />
              <p id="register-password-help" className="text-xs text-muted-foreground mt-1">
                {SIGNUP_PASSWORD_HELP} Special characters include !, @, #, and ?.
                Symbols such as emoji do not count as the required special character.
              </p>
            </div>

            <div>
              <label htmlFor="register-gender" className="block text-sm font-medium text-foreground mb-1.5">
                Gender
              </label>
              <select
                id="register-gender"
                value={form.gender}
                onChange={(e) => setForm((f) => ({ ...f, gender: e.target.value as "" | "female" | "male" }))}
                aria-describedby="register-private-help"
                required
                className="w-full px-3 py-2.5 border border-input rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition"
              >
                <option value="" disabled>Select your gender</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
              </select>
            </div>

            <div>
              <label htmlFor="register-birth-date" className="block text-sm font-medium text-foreground mb-1.5">
                Date of birth
              </label>
              <input
                id="register-birth-date"
                type="date"
                autoComplete="bday"
                value={form.dateOfBirth}
                onChange={(e) => setForm((f) => ({ ...f, dateOfBirth: e.target.value }))}
                min="0001-01-01"
                max={new Date().toISOString().slice(0, 10)}
                aria-describedby="register-private-help"
                required
                className="w-full px-3 py-2.5 border border-input rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition"
              />
              <p id="register-private-help" className="text-xs text-muted-foreground mt-1">
                Gender and date of birth are required for new accounts and are kept private.
                They do not appear on your profile and do not verify your age or school enrollment.
              </p>
            </div>

            <fieldset>
              <legend className="block text-sm font-medium text-foreground mb-2">
                I want to be a...
              </legend>
              <div className="grid grid-cols-3 gap-2">
                {(["mentee", "mentor", "both"] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, role: r }))}
                    className={`py-2.5 rounded-lg text-sm font-medium border transition-colors capitalize ${
                      form.role === r
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-foreground border-input hover:bg-accent"
                    }`}
                  >
                    {r === "both"
                      ? "Both"
                      : r === "mentor"
                        ? "Mentor"
                        : "Mentee"}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {form.role === "mentor" &&
                  "You'll offer guidance to other students"}
                {form.role === "mentee" &&
                  "You'll receive guidance from other students"}
                {form.role === "both" &&
                  "You'll both give and receive guidance"}
              </p>
            </fieldset>

            <div>
              <label htmlFor="district-search" className="block text-sm font-medium text-foreground mb-1.5">
                School district
              </label>
              <input
                id="district-search"
                type="text"
                placeholder="Search districts..."
                value={districtSearch}
                onChange={(e) => {
                  setDistrictSearch(e.target.value);
                  setForm((f) => ({ ...f, districtId: 0 }));
                }}
                className="w-full px-3 py-2.5 border border-input rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition mb-2"
              />
              <label htmlFor="district-choice" className="sr-only">District choices</label>
              <select
                id="district-choice"
                value={selectedDistrict?.id ?? ""}
                disabled={districtsUnavailable}
                onChange={(e) =>
                  setForm((f) => ({ ...f, districtId: Number(e.target.value) }))
                }
                required
                className="w-full px-3 py-2.5 border border-input rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition"
                size={4}
              >
                <option value="" disabled>
                  Select your district
                </option>
                {districts?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({countyLabel(d.county)} · {districtTypeLabel(d.type)})
                  </option>
                ))}
              </select>
              {districtsError ? (
                <div className="mt-2">
                  <p role="alert" className="text-sm text-destructive">
                    Couldn't load school districts. Please try again.
                  </p>
                  <button
                    type="button"
                    onClick={() => void retryDistricts()}
                    disabled={districtsFetching}
                    className="mt-2 rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
                  >
                    Retry districts
                  </button>
                </div>
              ) : districtsPending || districtsFetching ? (
                <p role="status" className="mt-2 text-sm text-muted-foreground">
                  Loading districts...
                </p>
              ) : districts?.length === 0 ? (
                <p role="status" className="mt-2 text-sm text-muted-foreground">
                  {districtSearch
                    ? "No districts match your search."
                    : "No school districts are available."}
                </p>
              ) : null}
              {selectedDistrict && !districtsUnavailable && (
                <p className="text-xs text-primary mt-1">
                  Selected: {selectedDistrict.name}
                </p>
              )}
            </div>

            {error && (
              <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2" role="alert">
                {error}
              </p>
            )}

            {needsConfirmation && (
              <button
                type="button"
                disabled={pending}
                onClick={() => void retrySession()}
                className="w-full rounded-lg border px-3 py-2 disabled:opacity-50"
              >
                Recheck session
              </button>
            )}

            <button
              type="submit"
              disabled={pending || districtsUnavailable || !selectedDistrict}
              className="w-full py-2.5 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {pending ? "Creating account..." : "Create account"}
            </button>
          </form>

          <p className="text-center text-sm text-muted-foreground mt-6">
            Already have an account?{" "}
            <Link href="/login">
              <span className="text-primary font-medium hover:underline">
                Sign in
              </span>
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
