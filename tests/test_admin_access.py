"""Current database privileges guard all operational APIs and public projections."""
from urllib.request import build_opener
import pytest
from backend_support import api, login
from test_account_trust import execute

OPERATIONS = ('/api/analysis/status','/api/analytics/weekly-matches','/api/analytics/popular-subjects',
              '/api/analytics/popular-time-slots','/api/analytics/mentor-response-rates',
              '/api/admin/flagged-users','/api/admin/reports','/api/matches/1',
              '/api/stats/overview','/api/stats/district/1')


def test_admin_boundary_and_live_revocation(backend_database,backend_server):
    with backend_server() as base:
        student,_=login(base,'student001@test.edu')
        for path in OPERATIONS:
            assert api(build_opener(),base,'GET',path)[0] == 401,path
            assert api(student,base,'GET',path)[0] == 403,path
        execute(backend_database,'UPDATE users SET is_admin=true WHERE id=1')
        assert api(student,base,'GET','/api/admin/reports')[0] == 200
        execute(backend_database,'UPDATE users SET is_admin=false WHERE id=1')
        assert api(student,base,'GET','/api/admin/reports')[0] == 403


def test_private_profile_safe_mentor_directory_and_blocks(backend_database,backend_server):
    with backend_server() as base:
        student,_=login(base,'student001@test.edu')
        assert api(build_opener(),base,'GET','/api/users/501')[0] == 401
        status,peer=api(student,base,'GET','/api/users/501')
        assert status == 200
        public={'id','name','role','subjects','districtId','districtName','bio'}
        assert set(peer) == {"id","name","subjects","createdAt"}
        status,mentors=api(student,base,'GET','/api/mentors')
        assert status == 200
        assert [m['id'] for m in mentors] == [501]
        assert all(set(m)==public for m in mentors)
        assert api(student,base,'GET','/api/users/502')[0] == 403
        execute(backend_database,'UPDATE users SET email_verified_at=NULL,is_verified=false WHERE id=501')
        assert api(student,base,'GET','/api/mentors')[1] == []


def test_report_content_admin_only_and_moderation_audit(backend_database,backend_server):
    with backend_server() as base:
        student,_=login(base,'student001@test.edu')
        assert api(student,base,'POST','/api/reports',{'reportedUserId':501,'reason':'other','description':'private report'})[0] == 201
        assert api(student,base,'GET','/api/admin/reports')[0] == 403
        execute(backend_database,'UPDATE users SET is_admin=true WHERE id=501')
        admin,_=login(base,'mentor501@test.edu')
        status,reports=api(admin,base,'GET','/api/admin/reports?status=open&limit=1')
        assert status == 200 and reports[0]['description']=='private report'
        assert reports[0]['targetType']=='profile'
        assert reports[0]['requestId'] is None and reports[0]['requestTitle'] is None
        path=f"/api/admin/reports/{reports[0]['id']}"
        assert api(student,base,'PATCH',path,{'status':'resolved'})[0] == 403
        status,report=api(admin,base,'PATCH',path,{'status':'reviewing','note':'Internal'})
        assert status == 200 and report['reviewedBy']==501 and report['reviewedAt'] and report['note']=='Internal'
        assert api(admin,base,'PATCH',path,{'status':'invalid'})[0] == 422
        assert api(student,base,'POST','/api/reports',{'reportedUserId':501,'reason':'other','description':'x'*2001})[0] == 422


@pytest.mark.parametrize('email',['student001@test.edu','mentor501@test.edu','both951@test.edu'])
def test_every_student_role_denied_operational_get_and_mutation(backend_server,email):
    with backend_server() as base:
        client,_=login(base,email)
        paths=OPERATIONS+('/api/practice/status','/api/practice/raw/locations','/api/scheduling/status',
                          '/api/scheduling/overview','/api/python-reports/status','/api/python-reports/summary')
        for path in paths:
            assert api(client,base,'GET',path)[0]==403,path
        for path,body in [('/api/matches',{'question_id':1}),('/api/practice/locations/test',{}),('/api/admin/reports/1',{'status':'resolved'})]:
            method='PATCH' if '/admin/reports/' in path else 'POST'
            assert api(client,base,method,path,body)[0]==403,path
            assert api(build_opener(),base,method,path,body)[0]==401,path


def test_district_list_is_public_and_details_require_membership(backend_database,backend_server):
    from test_account_trust import unverify
    unverify(backend_database)
    with backend_server() as base:
        anonymous=build_opener()
        assert api(anonymous,base,'GET','/api/districts')[0]==200
        assert api(anonymous,base,'GET','/api/districts/1')[0]==401
        student,_=login(base,'student001@test.edu')
        assert api(student,base,'GET','/api/districts/1')[0]==403
        for email in ['mentor501@test.edu','both951@test.edu']:
            verified,_=login(base,email)
            assert api(verified,base,'GET','/api/districts/1')[0]==200


@pytest.mark.parametrize('path',['/api/stats/overview','/api/stats/district/1'])
def test_stats_require_current_verified_admin_authority(backend_database,backend_server,path):
    with backend_server() as base:
        assert api(build_opener(),base,'GET',path)[0]==401
        student,_=login(base,'student001@test.edu')
        assert api(student,base,'GET',path)[0]==403
        execute(backend_database,'UPDATE users SET is_admin=true WHERE id=501')
        admin,_=login(base,'mentor501@test.edu')
        status,stats=api(admin,base,'GET',path)
        assert status==200
        if path.endswith('overview'):
            assert stats['totalUsers']==5 and stats['totalDistricts']==2
        else:
            assert stats['districtId']==1 and stats['memberCount']==3
        execute(backend_database,'UPDATE users SET is_admin=false WHERE id=501')
        assert api(admin,base,'GET',path)[0]==403
