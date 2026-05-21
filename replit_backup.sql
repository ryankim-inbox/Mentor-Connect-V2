--
-- PostgreSQL database dump
--

\restrict 5cAekvrw20a1defe7tcFMmakl33XKIRpp4T03TUWf2HiDFVc5C1sT26QEXAutOD

-- Dumped from database version 16.10
-- Dumped by pg_dump version 16.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: blocks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.blocks (
    id integer NOT NULL,
    blocker_id integer NOT NULL,
    blocked_user_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: blocks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.blocks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: blocks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.blocks_id_seq OWNED BY public.blocks.id;


--
-- Name: districts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.districts (
    id integer NOT NULL,
    name text NOT NULL,
    county text NOT NULL,
    type text DEFAULT 'unified'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: districts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.districts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: districts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.districts_id_seq OWNED BY public.districts.id;


--
-- Name: reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reports (
    id integer NOT NULL,
    reporter_id integer NOT NULL,
    reported_user_id integer NOT NULL,
    reason text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: reports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.reports_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: reports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.reports_id_seq OWNED BY public.reports.id;


--
-- Name: request_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.request_tags (
    id integer NOT NULL,
    request_id integer NOT NULL,
    tag_id integer NOT NULL
);


--
-- Name: request_tags_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.request_tags_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: request_tags_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.request_tags_id_seq OWNED BY public.request_tags.id;


--
-- Name: requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.requests (
    id integer NOT NULL,
    author_id integer NOT NULL,
    district_id integer NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    role text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    matched_user_id integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.requests_id_seq OWNED BY public.requests.id;


--
-- Name: tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tags (
    id integer NOT NULL,
    name text NOT NULL,
    color text DEFAULT '#6366f1'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tags_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tags_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tags_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tags_id_seq OWNED BY public.tags.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    email text NOT NULL,
    name text NOT NULL,
    password_hash text NOT NULL,
    role text DEFAULT 'mentee'::text NOT NULL,
    district_id integer NOT NULL,
    bio text,
    subjects text[] DEFAULT '{}'::text[] NOT NULL,
    is_verified boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: blocks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blocks ALTER COLUMN id SET DEFAULT nextval('public.blocks_id_seq'::regclass);


--
-- Name: districts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.districts ALTER COLUMN id SET DEFAULT nextval('public.districts_id_seq'::regclass);


--
-- Name: reports id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports ALTER COLUMN id SET DEFAULT nextval('public.reports_id_seq'::regclass);


--
-- Name: request_tags id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_tags ALTER COLUMN id SET DEFAULT nextval('public.request_tags_id_seq'::regclass);


--
-- Name: requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requests ALTER COLUMN id SET DEFAULT nextval('public.requests_id_seq'::regclass);


--
-- Name: tags id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags ALTER COLUMN id SET DEFAULT nextval('public.tags_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Data for Name: blocks; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.blocks (id, blocker_id, blocked_user_id, created_at) FROM stdin;
\.


--
-- Data for Name: districts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.districts (id, name, county, type, created_at) FROM stdin;
80	Fremont Union High School District	Santa Clara	high_school	2026-04-09 02:52:28.559786+00
81	East Side Union High School District	Santa Clara	high_school	2026-04-09 02:52:28.559786+00
82	Campbell Union High School District	Santa Clara	high_school	2026-04-09 02:52:28.559786+00
83	Los Gatos-Saratoga Joint Union High School District	Santa Clara	high_school	2026-04-09 02:52:28.559786+00
84	Mountain View-Los Altos Union High School District	Santa Clara	high_school	2026-04-09 02:52:28.559786+00
85	Palo Alto Unified School District	Santa Clara	high_school	2026-04-09 02:52:28.559786+00
86	Santa Clara Unified School District	Santa Clara	high_school	2026-04-09 02:52:28.559786+00
87	Milpitas Unified School District	Santa Clara	high_school	2026-04-09 02:52:28.559786+00
88	Gilroy Unified School District	Santa Clara	high_school	2026-04-09 02:52:28.559786+00
89	Morgan Hill Unified School District	Santa Clara	high_school	2026-04-09 02:52:28.559786+00
90	Sunnyvale School District	Santa Clara	high_school	2026-04-09 02:52:28.559786+00
91	Saratoga Union School District	Santa Clara	high_school	2026-04-09 02:52:28.559786+00
92	Fremont Unified School District	Alameda	high_school	2026-04-09 02:52:28.559786+00
93	Newark Unified School District	Alameda	high_school	2026-04-09 02:52:28.559786+00
94	New Haven Unified School District	Alameda	high_school	2026-04-09 02:52:28.559786+00
95	Hayward Unified School District	Alameda	high_school	2026-04-09 02:52:28.559786+00
96	San Leandro Unified School District	Alameda	high_school	2026-04-09 02:52:28.559786+00
97	Castro Valley Unified School District	Alameda	high_school	2026-04-09 02:52:28.559786+00
98	Livermore Valley Joint Unified School District	Alameda	high_school	2026-04-09 02:52:28.559786+00
99	Pleasanton Unified School District	Alameda	high_school	2026-04-09 02:52:28.559786+00
100	Dublin Unified School District	Alameda	high_school	2026-04-09 02:52:28.559786+00
101	San Lorenzo Unified School District	Alameda	high_school	2026-04-09 02:52:28.559786+00
102	Alameda Unified School District	Alameda	high_school	2026-04-09 02:52:28.559786+00
103	Berkeley Unified School District	Alameda	high_school	2026-04-09 02:52:28.559786+00
\.


--
-- Data for Name: reports; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.reports (id, reporter_id, reported_user_id, reason, description, created_at) FROM stdin;
\.


--
-- Data for Name: request_tags; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.request_tags (id, request_id, tag_id) FROM stdin;
5	2	8
6	2	10
7	2	16
8	2	15
9	3	3
10	3	7
11	3	20
\.


--
-- Data for Name: requests; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.requests (id, author_id, district_id, title, description, role, status, matched_user_id, created_at, updated_at) FROM stdin;
2	4	82	help	I need help	mentee	open	\N	2026-04-30 03:00:03.3175+00	2026-04-30 03:00:03.3175+00
3	4	97	helppppp	lolo	mentor	open	\N	2026-04-30 03:00:32.013951+00	2026-04-30 03:00:32.013951+00
\.


--
-- Data for Name: tags; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.tags (id, name, color, created_at) FROM stdin;
1	Math	#3b82f6	2026-04-09 02:41:32.80768+00
2	Science	#10b981	2026-04-09 02:41:32.80768+00
3	English	#f59e0b	2026-04-09 02:41:32.80768+00
4	History	#8b5cf6	2026-04-09 02:41:32.80768+00
5	Computer Science	#06b6d4	2026-04-09 02:41:32.80768+00
6	College Prep	#ec4899	2026-04-09 02:41:32.80768+00
7	SAT/ACT	#f97316	2026-04-09 02:41:32.80768+00
8	AP Courses	#14b8a6	2026-04-09 02:41:32.80768+00
9	Spanish	#a855f7	2026-04-09 02:41:32.80768+00
10	Arts	#e11d48	2026-04-09 02:41:32.80768+00
11	Music	#7c3aed	2026-04-09 02:41:32.80768+00
12	Sports	#16a34a	2026-04-09 02:41:32.80768+00
13	Mental Health	#0ea5e9	2026-04-09 02:41:32.80768+00
14	Career Guidance	#d97706	2026-04-09 02:41:32.80768+00
15	Engineering	#059669	2026-04-09 02:41:32.80768+00
16	Biology	#65a30d	2026-04-09 02:41:32.80768+00
17	Chemistry	#dc2626	2026-04-09 02:41:32.80768+00
18	Physics	#2563eb	2026-04-09 02:41:32.80768+00
19	Writing	#c2410c	2026-04-09 02:41:32.80768+00
20	Research	#0891b2	2026-04-09 02:41:32.80768+00
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.users (id, email, name, password_hash, role, district_id, bio, subjects, is_verified, created_at, updated_at) FROM stdin;
3	ericpark@a.edu	Eric Park	$2b$10$WizxKJgd0OvlrCRy/BI4/O3PWCSqehi5q2wZapn08S5ox0tVpSlk6	both	103	\N	{}	t	2026-04-09 02:57:40.393099+00	2026-04-09 02:57:40.393099+00
4	ssinkbig@naver.edu	Eric Park	$2b$12$aD/iNrz0YoqDtDGcKhmiIedt4GkpMXnlcmILLB0IYtZlm3my2Axie	mentee	103	\N	{}	t	2026-04-30 02:46:32.222353+00	2026-04-30 02:46:32.222353+00
\.


--
-- Name: blocks_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.blocks_id_seq', 1, false);


--
-- Name: districts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.districts_id_seq', 103, true);


--
-- Name: reports_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.reports_id_seq', 1, false);


--
-- Name: request_tags_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.request_tags_id_seq', 11, true);


--
-- Name: requests_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.requests_id_seq', 3, true);


--
-- Name: tags_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.tags_id_seq', 20, true);


--
-- Name: users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.users_id_seq', 4, true);


--
-- Name: blocks blocks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blocks
    ADD CONSTRAINT blocks_pkey PRIMARY KEY (id);


--
-- Name: districts districts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.districts
    ADD CONSTRAINT districts_pkey PRIMARY KEY (id);


--
-- Name: reports reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_pkey PRIMARY KEY (id);


--
-- Name: request_tags request_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_tags
    ADD CONSTRAINT request_tags_pkey PRIMARY KEY (id);


--
-- Name: requests requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requests
    ADD CONSTRAINT requests_pkey PRIMARY KEY (id);


--
-- Name: tags tags_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_name_unique UNIQUE (name);


--
-- Name: tags tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_pkey PRIMARY KEY (id);


--
-- Name: users users_email_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_unique UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: blocks blocks_blocked_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blocks
    ADD CONSTRAINT blocks_blocked_user_id_users_id_fk FOREIGN KEY (blocked_user_id) REFERENCES public.users(id);


--
-- Name: blocks blocks_blocker_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blocks
    ADD CONSTRAINT blocks_blocker_id_users_id_fk FOREIGN KEY (blocker_id) REFERENCES public.users(id);


--
-- Name: reports reports_reported_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_reported_user_id_users_id_fk FOREIGN KEY (reported_user_id) REFERENCES public.users(id);


--
-- Name: reports reports_reporter_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_reporter_id_users_id_fk FOREIGN KEY (reporter_id) REFERENCES public.users(id);


--
-- Name: request_tags request_tags_request_id_requests_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_tags
    ADD CONSTRAINT request_tags_request_id_requests_id_fk FOREIGN KEY (request_id) REFERENCES public.requests(id);


--
-- Name: requests requests_author_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requests
    ADD CONSTRAINT requests_author_id_users_id_fk FOREIGN KEY (author_id) REFERENCES public.users(id);


--
-- Name: requests requests_district_id_districts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requests
    ADD CONSTRAINT requests_district_id_districts_id_fk FOREIGN KEY (district_id) REFERENCES public.districts(id);


--
-- Name: requests requests_matched_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requests
    ADD CONSTRAINT requests_matched_user_id_users_id_fk FOREIGN KEY (matched_user_id) REFERENCES public.users(id);


--
-- Name: users users_district_id_districts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_district_id_districts_id_fk FOREIGN KEY (district_id) REFERENCES public.districts(id);


--
-- PostgreSQL database dump complete
--

\unrestrict 5cAekvrw20a1defe7tcFMmakl33XKIRpp4T03TUWf2HiDFVc5C1sT26QEXAutOD

